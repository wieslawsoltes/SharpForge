/**
 * Paired compile cost for existing expression trees and ordinary delegates (SF-A02-T07.5).
 * Run through scripts/limited.js with --expose-gc, --baseline/--candidate trusted checkout paths,
 * and --baseline-head/--candidate-head exact commits. Both compiler graphs use their own workspace aliases.
 * Compilation alone is timed. Explicit GC, output hashing and checkout verification occur outside the timer.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, arch, totalmem } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const option = (name, fallback) => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
};
function boundedCount(name, fallback, minimum, maximum) {
  const value = Number(option(name, fallback));
  assert.ok(Number.isInteger(value) && value >= minimum && value <= maximum, `${name}: ${minimum}..${maximum}`);
  return value;
}
const warmup = boundedCount('warmup', 80, 20, 200);
const rounds = boundedCount('rounds', 20, 12, 80);
assert.equal(rounds % 4, 0, 'rounds must balance all four order positions');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();

function verifyCheckout(graph) {
  assert.equal(git(graph.root, 'rev-parse', 'HEAD'), graph.head, `${graph.role}: exact commit changed`);
  assert.equal(git(graph.root, 'status', '--porcelain', '--untracked-files=all'), '', `${graph.role}: checkout must be clean`);
}

async function compilerGraph(role) {
  const supplied = option(role, null), head = option(role + '-head', null);
  assert.ok(supplied && /^[a-f0-9]{40}$/i.test(head ?? ''), `${role}: trusted checkout and full commit are required`);
  const root = realpathSync(supplied), entry = join(root, 'packages/compiler/src/index.js');
  const graph = { role, root, head };
  verifyCheckout(graph);
  const require = createRequire(entry);
  for (const name of ['text', 'syntax', 'cil', 'symbols', 'framework', 'bytecode']) {
    const resolved = realpathSync(require.resolve('@sharpforge/' + name));
    const path = relative(join(root, 'packages', name), resolved);
    assert.ok(!path.startsWith('..') && !isAbsolute(path), `${role}: ${name} must resolve inside its own checkout`);
  }
  graph.compile = (await import(pathToFileURL(entry).href)).compileToAssembly;
  return graph;
}

function program(trees) {
  const target = trees ? 'Expression<Func<int, int>>' : 'Func<int, int>';
  const members = Array.from({ length: 16 }, (_, index) =>
    `static ${target} Make${index}() => value => value * 2 + ${index};`).join('\n');
  return `using System; using System.Linq.Expressions; class Program { ${members} static void Main() { } }`;
}

function compileSample(graph, source) {
  globalThis.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  const result = graph.compile(source, { name: 'ExpressionTreeBenchmark' });
  const elapsedMs = performance.now() - start;
  const after = process.memoryUsage();
  assert.equal(result.success, true, `${graph.role}: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(result.assembly?.length > 0);
  return {
    elapsedMs, uncollectedHeapDeltaBytes: after.heapUsed - before.heapUsed, rssBytes: after.rss,
    assemblyBytes: result.assembly.length, assemblySha256: hash(result.assembly),
  };
}

function distribution(values) {
  const sorted = values.toSorted((left, right) => left - right), middle = sorted.length >> 1;
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], min: sorted[0], max: sorted.at(-1),
  };
}

function summarize(samples) {
  const sizes = new Set(samples.map(row => row.assemblyBytes));
  const outputs = new Set(samples.map(row => row.assemblySha256));
  assert.equal(sizes.size, 1, 'repeated output sizes must match');
  assert.equal(outputs.size, 1, 'repeated output bytes must match');
  return {
    elapsedMs: distribution(samples.map(row => row.elapsedMs)),
    uncollectedHeapDeltaBytes: distribution(samples.map(row => row.uncollectedHeapDeltaBytes)),
    rssBytes: distribution(samples.map(row => row.rssBytes)),
    assemblyBytes: samples[0].assemblyBytes, assemblySha256: samples[0].assemblySha256, samples,
  };
}

const startedAt = new Date().toISOString();
const graphs = [await compilerGraph('baseline'), await compilerGraph('candidate')];
const cases = [
  { name: 'ordinary-delegates', source: program(false), samples: { baseline: [], candidate: [] } },
  { name: 'existing-expression-trees', source: program(true), samples: { baseline: [], candidate: [] } },
];
for (let round = -warmup; round < rounds; round++) {
  const sequence = round + warmup;
  // Rotate the workload order every two rounds and reverse the compiler order every round.
  for (let offset = 0; offset < cases.length; offset++) {
    const fixture = cases[(Math.floor(sequence / 2) + offset) % cases.length];
    const order = sequence % 2 ? [1, 0] : [0, 1];
    for (const index of order) {
      const graph = graphs[index], sample = compileSample(graph, fixture.source);
      if (round >= 0) fixture.samples[graph.role].push(sample);
    }
  }
}
for (const graph of graphs) verifyCheckout(graph);
const comparisons = cases.map(fixture => {
  const baseline = summarize(fixture.samples.baseline), candidate = summarize(fixture.samples.candidate);
  return {
    name: fixture.name, source: fixture.source, sourceSha256: hash(fixture.source), baseline, candidate,
    medianChangePercent: (candidate.elapsedMs.median / baseline.elapsedMs.median - 1) * 100,
    p95ChangePercent: (candidate.elapsedMs.p95 / baseline.elapsedMs.p95 - 1) * 100,
    assemblySizeChangePercent: (candidate.assemblyBytes / baseline.assemblyBytes - 1) * 100,
  };
});
console.log(JSON.stringify({
  startedAt, finishedAt: new Date().toISOString(),
  harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
  graphs: graphs.map(({ role, root, head }) => ({ role, root, head })),
  node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, memoryBytes: totalmem(),
  warmupPerWorkloadAndSide: warmup, measuredRounds: rounds, gcAvailable: typeof globalThis.gc === 'function',
  pipeline: 'compileToAssembly with framework registry; parse, bind, lower and direct CIL emit',
  notes: 'Shared host; both compiler graphs remain loaded. Heap deltas may include GC and are not allocation counts. RSS is process-wide.',
  comparisons,
}, null, 2));
