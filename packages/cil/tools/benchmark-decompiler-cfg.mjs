import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { arithmeticLibrary } from '../../../tests/managed-fixtures.js';

const baselineCommit = '8b101c0c7e8ad73675dfe12e68f26329d7ea2d9c';
const implementationCommit = 'b86dc79001c68d8d7558487f35984e2682c8f1d3';
const candidateRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const batches = Object.freeze({ warmup: 20, samples: 100, iterations: 200 });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
let checksum = 0;

function argumentsFor(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--baseline', '--output'].includes(key) || !args[index + 1] || Object.hasOwn(values, key)) {
      throw Error('Usage: node benchmark-decompiler-cfg.mjs --baseline /path/to/8b101c0c --output /path/to/result.json');
    }
    values[key] = args[index + 1];
  }
  if (!values['--baseline'] || !values['--output']) throw Error('Both --baseline and --output are required');
  return { baseline: realpathSync(resolve(values['--baseline'])), output: resolve(values['--output']) };
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim();
}

function revision(root, expected, exactHead) {
  const commit = git(root, 'rev-parse', 'HEAD');
  if (exactHead) assert.equal(commit, expected, 'Baseline must be the declared pre-CFG revision');
  // Documentation/tool commits may follow the tested implementation, but no source drift is admitted.
  git(root, 'diff', '--exit-code', expected, '--', ':(glob)packages/*/src/**', 'tests/managed-fixtures.js');
  return { root, commit, tree: git(root, 'rev-parse', 'HEAD^{tree}'), sourceRevision: expected,
    trackedChanges: git(root, 'diff', '--name-only', 'HEAD').split('\n').filter(Boolean) };
}

function workspaceAliases(root) {
  const packagePath = resolve(root, 'packages/cil/package.json');
  const dependencies = Object.keys(JSON.parse(readFileSync(packagePath)).dependencies ?? {});
  const aliases = {};
  for (const name of ['@sharpforge/cil', ...dependencies]) {
    if (!name.startsWith('@sharpforge/')) continue;
    const importer = name === '@sharpforge/cil' ? resolve(root, 'tests/managed-fixtures.js') : packagePath;
    const actual = realpathSync(createRequire(importer).resolve(name));
    const expected = realpathSync(resolve(root, 'packages', name.slice('@sharpforge/'.length), 'src/index.js'));
    assert.equal(actual, expected, `${name} must resolve inside its own checkout`);
    aliases[name] = actual;
  }
  return aliases;
}

function legacy(result) {
  return { token: result.token, name: result.name, language: result.language,
    complete: result.complete, diagnostics: result.diagnostics, source: result.source };
}

function dimensions(graph) {
  assert.equal(graph?.format, 'sharpforge.control-flow-graph');
  assert.equal(graph.version, 1);
  return { codeBytes: graph.codeSize, instructions: graph.instructionCount, blocks: graph.blocks.length,
    edges: graph.edges.length, exceptionClauses: graph.exceptionBoundaries.length };
}

function prepareCase(sample, libraries) {
  const inspectors = {};
  const initial = {};
  for (const variant of ['baseline', 'candidate']) {
    // Each library must receive its own AssemblyInspector instance for its instanceof admission check.
    inspectors[variant] = new libraries[variant].AssemblyInspector(sample.bytes.slice());
    inspectors[variant].getMethod(sample.token);
    initial[variant] = libraries[variant].decompileMethod(inspectors[variant], sample.token);
  }
  assert.deepEqual(legacy(initial.candidate), legacy(initial.baseline), `${sample.name}: pre-timing legacy output`);
  assert.equal(Object.hasOwn(initial.baseline, 'controlFlowGraph'), false, 'Baseline unexpectedly has CFG output');
  if (sample.name === 'ArithmeticAdd') assert.equal(initial.candidate.complete, true);
  if (sample.name === 'NativeFinally') {
    assert.equal(initial.candidate.complete, false);
    assert.equal(initial.candidate.language, 'cil');
  }
  return { ...sample, inspectors, expected: legacy(initial.baseline), graph: initial.candidate.controlFlowGraph,
    dimensions: dimensions(initial.candidate.controlFlowGraph) };
}

function runBatch(sample, variant, libraries) {
  const library = libraries[variant];
  const inspector = sample.inspectors[variant];
  let batchChecksum = 0;
  const start = performance.now();
  for (let iteration = 0; iteration < batches.iterations; iteration++) {
    const result = library.decompileMethod(inspector, sample.token);
    batchChecksum += result.source.length + Number(result.complete);
  }
  const elapsedMs = performance.now() - start;
  // The equal guard is outside the timed region; source equality is checked before and after all timing.
  assert.equal(batchChecksum, (sample.expected.source.length + Number(sample.expected.complete)) * batches.iterations);
  checksum += batchChecksum;
  return elapsedMs;
}

function measure(cases, libraries) {
  const chronologicalSamples = [];
  for (let round = -batches.warmup; round < batches.samples; round++) {
    const variants = Math.abs(round) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (let slot = 0; slot < cases.length; slot++) {
      const sample = cases[(slot + Math.abs(round)) % cases.length];
      for (const variant of variants) {
        const elapsedMs = runBatch(sample, variant, libraries);
        if (round < 0) continue;
        chronologicalSamples.push({ sequence: chronologicalSamples.length, round, case: sample.name, variant,
          elapsedMs, nanosecondsPerCall: elapsedMs * 1_000_000 / batches.iterations });
      }
    }
  }
  return chronologicalSamples;
}

function summary(values) {
  assert.equal(values.length, batches.samples, 'Every variant/case must retain every measured sample');
  const sorted = values.toSorted((left, right) => left - right);
  return { samples: sorted.length, medianNanosecondsPerCall: (sorted[49] + sorted[50]) / 2,
    p95NanosecondsPerCall: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

function summarize(cases, libraries, samples) {
  return cases.map(sample => {
    for (const variant of ['baseline', 'candidate']) {
      const result = libraries[variant].decompileMethod(sample.inspectors[variant], sample.token);
      assert.deepEqual(legacy(result), sample.expected, `${sample.name}: post-timing ${variant} output`);
      if (variant === 'candidate') assert.deepEqual(result.controlFlowGraph, sample.graph, 'Stable candidate graph');
    }
    const result = {};
    for (const variant of ['baseline', 'candidate']) {
      result[variant] = summary(samples.filter(value => value.case === sample.name && value.variant === variant)
        .map(value => value.nanosecondsPerCall));
    }
    return { name: sample.name, token: sample.token, imageSha256: sha256(sample.bytes),
      language: sample.expected.language, complete: sample.expected.complete,
      sourceSha256: sha256(sample.expected.source), sourceCharacters: sample.expected.source.length,
      legacyEqualityBeforeAndAfter: true, candidateGraph: sample.dimensions, ...result,
      medianFeatureCostPercent: (result.candidate.medianNanosecondsPerCall / result.baseline.medianNanosecondsPerCall - 1) * 100 };
  });
}

const args = argumentsFor(process.argv.slice(2));
assert.notEqual(args.baseline, candidateRoot, 'Baseline and candidate must use distinct checkouts');
const revisions = { baseline: revision(args.baseline, baselineCommit, true),
  candidate: revision(candidateRoot, implementationCommit, false) };
const aliases = { baseline: workspaceAliases(args.baseline), candidate: workspaceAliases(candidateRoot) };
const fixturePath = resolve(candidateRoot, 'tests/fixtures/decompiler-cfg/native.json');
const fixtureBytes = readFileSync(fixturePath);
const reference = JSON.parse(fixtureBytes);
const nativeImage = new Uint8Array(Buffer.from(reference.image, 'base64'));
assert.equal(sha256(nativeImage), reference.imageSha256, 'Native image integrity');
assert.equal(reference.toolchain.runtime, '10.0.5', 'Pinned native reference');
const nativeCase = name => {
  const methods = reference.native.methods.filter(method => method.name === name);
  assert.equal(methods.length, 1, `Unique captured ${name} method`);
  return { name: `Native${name}`, bytes: nativeImage, token: methods[0].token };
};
const libraries = {
  baseline: await import(pathToFileURL(resolve(args.baseline, 'packages/cil/src/index.js')).href),
  candidate: await import(pathToFileURL(resolve(candidateRoot, 'packages/cil/src/index.js')).href),
};
const cases = [{ name: 'ArithmeticAdd', bytes: arithmeticLibrary(), token: 0x06000001 }, nativeCase('Loop'), nativeCase('Finally')]
  .map(sample => prepareCase(sample, libraries));
const chronologicalSamples = measure(cases, libraries);
const results = summarize(cases, libraries, chronologicalSamples);
const cpu = cpus();
const report = { format: 'sharpforge.decompiler-cfg-benchmark', version: 1, timestamp: new Date().toISOString(),
  revisions, workspaceAliases: aliases, driverSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  nativeFixtureSha256: sha256(fixtureBytes),
  environment: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: release(),
    cpu: cpu[0]?.model ?? null, logicalCpus: cpu.length, totalMemoryBytes: totalmem(), sharedHost: true },
  configuration: { warmupBatchesPerCaseAndVariant: batches.warmup, measuredSamplesPerCaseAndVariant: batches.samples,
    iterationsPerBatch: batches.iterations, clock: 'performance.now', variantOrder: 'alternates each round',
    caseOrder: 'rotates each round', median: 'mean of the two central samples', p95: 'nearest rank',
    inspector: 'separate cached inspector from each library; method lookup prewarmed outside timing' },
  interpretation: 'Candidate cost includes constructing the new CFG output; this is not a same-result speedup comparison.',
  limitations: ['Shared host: scheduling, GC and concurrent load can affect samples.',
    'No allocation counter, forced GC or isolated opcode measurement is used.',
    'The Finally fallback includes the existing IL-formatting work performed inside decompileMethod.',
    'Inspector construction, initial method lookup, equality checks and result summarization are outside timing.'],
  allocationCounter: null, checksum, results, chronologicalSamples };
writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: args.output, results }, null, 2));
