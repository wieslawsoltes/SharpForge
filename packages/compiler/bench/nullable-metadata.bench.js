/**
 * End-to-end nullable metadata cost with both revisions and binding modes warmed and interleaved.
 * Run through scripts/limited.js with --expose-gc and --baseline <checkout>; --output saves every raw sample.
 * The baseline checkout needs its own workspace links so it never resolves packages from the current revision.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, totalmem } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locateReferencePack, readReferenceFiles } from '@sharpforge/compiler/node';

function argument(name, fallback = null) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function count(name, fallback) {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error('--' + name + ' must be an integer from 1 to 1000');
  return value;
}

const directory = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = argument('baseline');
if (!baseline) throw new Error('An exact --baseline checkout is required.');
const sourcePath = 'tests/fixtures/nullable-metadata/NullableMetadata.cs';
const source = readFileSync(resolve(directory, sourcePath), 'utf8');
const warmup = count('warmup', 80);
const samples = count('samples', 20);
const options = { name: 'NullableMetadataBenchmark', outputKind: 'library', allowUnsafe: true, portablePdb: false };
const pack = locateReferencePack();
if (!pack) throw new Error('A real .NET reference pack is required; set DOTNET_ROOT.');
const images = readReferenceFiles(pack.files);

function git(checkout, ...args) {
  return execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', timeout: 10_000 }).trim();
}

async function compiler(name, checkout) {
  const require = createRequire(resolve(checkout, 'package.json'));
  const path = require.resolve('@sharpforge/compiler');
  const local = relative(checkout, path);
  if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) {
    throw new Error('Compiler workspace resolved outside its revision: ' + path);
  }
  const library = await import(pathToFileURL(path).href);
  // Each revision decodes identical bytes into its own symbol classes; reference loading is outside the timing.
  const references = library.createReferenceSet(images);
  return { name, library, references, commit: git(checkout, 'rev-parse', 'HEAD') };
}

const revisions = [await compiler('baseline', resolve(baseline)), await compiler('current', directory)];
const cases = revisions.flatMap(revision => ['registry', 'cachedReferences'].map(mode => ({
  revision, mode, options: { ...options, ...(mode === 'cachedReferences' ? { references: revision.references } : {}) },
  assemblyBytes: null, samples: [], warmupMs: [],
})));

function run(entry, measured) {
  const before = process.memoryUsage();
  const start = performance.now();
  const result = entry.revision.library.compileToAssembly(source, entry.options);
  const elapsedMs = performance.now() - start;
  const after = process.memoryUsage();
  if (!result.assembly || result.diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    throw new Error(entry.revision.name + '/' + entry.mode + ' failed: ' + JSON.stringify(result.diagnostics));
  }
  if (entry.assemblyBytes !== null && entry.assemblyBytes !== result.assembly.length) {
    throw new Error('Non-deterministic assembly size for ' + entry.revision.name + '/' + entry.mode);
  }
  entry.assemblyBytes = result.assembly.length;
  if (measured) entry.samples.push({
    elapsedMs, heapDeltaBytes: after.heapUsed - before.heapUsed,
    arrayBufferDeltaBytes: after.arrayBuffers - before.arrayBuffers,
  });
  else entry.warmupMs.push(elapsedMs);
}

function round(index, measured) {
  // Rotating the starting case balances first/last position without a nondeterministic random seed.
  for (let offset = 0; offset < cases.length; offset++) run(cases[(index + offset) % cases.length], measured);
}

for (let index = 0; index < warmup; index++) round(index, false);
global.gc?.();
const retainedBefore = process.memoryUsage();
for (let index = 0; index < samples; index++) round(index, true);
global.gc?.();
const retainedAfter = process.memoryUsage();

function summary(entry) {
  const times = entry.samples.map(sample => sample.elapsedMs).sort((left, right) => left - right);
  const center = Math.floor(times.length / 2);
  return {
    revision: entry.revision.name, commit: entry.revision.commit, mode: entry.mode,
    medianMs: times.length % 2 ? times[center] : (times[center - 1] + times[center]) / 2,
    p95Ms: times[Math.ceil(times.length * 0.95) - 1], assemblyBytes: entry.assemblyBytes,
    warmupMs: entry.warmupMs, samples: entry.samples,
  };
}

const report = {
  benchmark: 'SF-A02-T05.3 nullable metadata end-to-end compilation',
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, memoryBytes: totalmem(), explicitGc: typeof global.gc === 'function' },
  fixture: { path: sourcePath, sha256: createHash('sha256').update(source).digest('hex'), bytes: Buffer.byteLength(source) },
  options,
  referencePack: { version: pack.version, targetFramework: pack.targetFramework, assemblies: pack.files.length },
  methodology: {
    warmup, samples, order: 'All four cases warmed; every measured round rotates the first case by one.',
    references: 'Cached-reference compilation; reading, decoding and initial cross-assembly binding are excluded.',
    allocationNote: 'Heap and ArrayBuffer end-minus-start deltas include natural GC; these are not allocation counters.',
    scope: 'Whole compiler revisions, including intervening integration changes; this is not isolated attribution to nullable planning.',
  },
  interveningCommits: git(directory, 'log', '--format=%H %s', revisions[0].commit + '..' + revisions[1].commit).split('\n'),
  retainedAcrossMeasuredRounds: {
    heapDeltaBytes: retainedAfter.heapUsed - retainedBefore.heapUsed,
    arrayBufferDeltaBytes: retainedAfter.arrayBuffers - retainedBefore.arrayBuffers,
  },
  results: cases.map(summary),
};
const output = argument('output');
if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(output ? {
  output, baseline: revisions[0].commit, current: revisions[1].commit,
  results: report.results.map(({ samples: raw, warmupMs: rawWarmup, ...result }) => result),
} : report, null, 2) + '\n');
