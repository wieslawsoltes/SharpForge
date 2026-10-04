# Historical measurement harnesses

These are verbatim copies of the external harnesses used for the retained capture.
They were outside both compiler worktrees so each measured revision stayed clean.
The reusable paired harness is [a02-extension-metadata-paired.mjs](../../../scripts/benchmarks/a02-extension-metadata-paired.mjs).
Its source was identical for the initial and final paired measurements.

## Separate-process warm harness

SHA-256: `978633e5eaadd500092f3c269e585057f85e84acaae83491e7d44dbe0890d87c`.
Copy the code block to an external `.mjs` file and provide an explicit
`--compiler-entry` when reproducing either revision. The retained pilot instead
used the three-warmup script present at `ed910584`.

```js
/** Fixed-source before/after compilation benchmark for extension metadata planning; run revisions serially. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compilerEntry = resolve(option('--compiler-entry', resolve(ownRoot, 'packages/compiler/src/index.js')));
const compilerRoot = resolve(dirname(compilerEntry), '../../..');
const count = Number(option('--members', 32)), sampleCount = Number(option('--samples', 20)), warmupCount = 80;
assert(Number.isInteger(count) && count >= 4 && count <= 128, '--members must be within 4..128');
assert(Number.isInteger(sampleCount) && sampleCount >= 10 && sampleCount <= 40, '--samples must be within 10..40');
const { compileToReferenceAssembly } = await import(pathToFileURL(compilerEntry));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
const dirtyWorktree = execFileSync('git', ['status', '--porcelain'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
assert.equal(dirtyWorktree, '', 'Benchmark requires a clean compiler worktree');
const text = (factory, prefix = '', suffix = '') => prefix + Array.from({ length: count }, (_, index) => factory(index)).join('\n') + suffix;
const cases = [
  { name: 'ordinary-methods', source: text(index => `public static int M${index}(int value) => value + ${index};`,
    'public static class Ordinary {\n', '\n}') },
  { name: 'extension-properties', source: text(index =>
    `extension(Box value${index}) { public int P${index} { get => value${index}.Value; set => value${index}.Value = value; } }`,
    'public class Box { public int Value; } public static class Extensions {\n', '\n}') },
  { name: 'generic-extension-members', source: text(index =>
    `extension<T>(Box<T> value${index}) where T : unmanaged {
      public T P${index} => value${index}.Value;
      public T M${index}(T first) => first;
    }`, 'public class Box<T> { public T Value; } public static class Extensions {\n', '\n}') },
];

function summary(values) {
  const sorted = values.toSorted((left, right) => left - right), middle = Math.floor(sorted.length / 2);
  return { median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

function compile(source) {
  const result = compileToReferenceAssembly(source, { name: 'ExtensionMetadataBenchmark', outputKind: 'library', langVersion: '14' });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert(result.assembly instanceof Uint8Array);
  return result.assembly;
}

function measure(source) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed, start = performance.now();
  const assembly = compile(source);
  const elapsedMs = performance.now() - start, heapUsedDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  return { elapsedMs, heapUsedDeltaBytes, outputBytes: assembly.length };
}

const initialLoad = loadavg();
for (let iteration = 0; iteration < warmupCount; iteration++) {
  for (const { source } of cases) compile(source);
}
const measurementInitialLoad = loadavg();
const results = cases.map(({ name, source }) => {
  const samples = Array.from({ length: sampleCount }, () => measure(source));
  assert.equal(new Set(samples.map(sample => sample.outputBytes)).size, 1, 'Output size changed between identical compilations');
  return { name, sourceBytes: Buffer.byteLength(source), sourceSha256: createHash('sha256').update(source).digest('hex'),
    elapsedMs: summary(samples.map(sample => sample.elapsedMs)), heapUsedDeltaBytes: summary(samples.map(sample => sample.heapUsedDeltaBytes)),
    outputBytes: samples[0].outputBytes, samples };
});
console.log(JSON.stringify({
  schemaVersion: 2, revision, dirtyPackages: !!dirty, dirtyWorktree: !!dirtyWorktree, compilerEntry,
  harnessSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  membersPerCase: count, sampleCount, warmupCount, warmupStrategy: 'Rotate all workloads for 80 rounds before collecting samples', gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Complete compileToReferenceAssembly on identical closed-reference source in each revision',
  provenance: 'Shared host; machine-wide resource wrapper and serial team validation slot; no claim of host isolation.',
  memoryMetric: 'Signed post-compilation heapUsed difference; includes any GC during compilation and is not an allocation count or peak heap.',
  initialLoad, measurementInitialLoad, finalLoad: loadavg(), cases: results,
}, null, 2));
```

## Bounded ordinary-workload CPU profile harness

SHA-256: `b1912b9a0594a0870fa027b90321a56927095e3e0e543fb7ba8a19d0fcf48411`.
Copy the code block to an external `.mjs` file and run through `scripts/limited.js`
with `--expose-gc`, `--baseline-entry`, `--candidate-entry` and `--output-dir`.
The profiled heads were `b19a56a7` and `ed910584`, before scope pruning.
Profile elapsed times are provenance, not additional benchmark samples.

```js
/** Bounded post-warmup ordinary-declaration CPU sampling for the paired metadata comparison. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const implementations = [];
for (const name of ['baseline', 'candidate']) {
  assert(args.includes(`--${name}-entry`));
  const compilerEntry = resolve(option(`--${name}-entry`));
  const compilerRoot = resolve(dirname(compilerEntry), '../../..');
  const settings = { cwd: compilerRoot, encoding: 'utf8' };
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], settings).trim();
  assert.equal(execFileSync('git', ['status', '--porcelain'], settings).trim(), '', 'Profile graph must be clean');
  const module = await import(pathToFileURL(compilerEntry));
  implementations.push({ name, compilerEntry, compilerRoot, revision, emit: module.compileToReferenceAssembly });
}
const outputDirectory = resolve(option('--output-dir'));
mkdirSync(outputDirectory, { recursive: true });
const count = 32;
const source = 'public static class Ordinary {\n' + Array.from({ length: count }, (_, index) =>
  `public static int M${index}(int value) => value + ${index};`).join('\n') + '\n}';
const sourceSha256 = createHash('sha256').update(source).digest('hex');
assert.equal(sourceSha256, 'f16cdfc69bdfdd275748976c076650a64be93564138e6424a4b9e98489afeee8');
function compile(implementation) {
  const result = implementation.emit(source, { name: 'ExtensionMetadataBenchmark', outputKind: 'library', langVersion: '14' });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.assembly.length, implementation.name === 'baseline' ? 2048 : 2560);
}
const warmupCount = 80;
const profileCompilations = 128;
const samplingIntervalMicroseconds = 500;
for (let round = 0; round < warmupCount; round++) {
  const order = round % 2 ? implementations.toReversed() : implementations;
  for (const implementation of order) compile(implementation);
}
const session = new Session();
session.connect();
function post(method, parameters = {}) {
  return new Promise((resolveResult, reject) => {
    session.post(method, parameters, (error, result) => error ? reject(error) : resolveResult(result));
  });
}
await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: samplingIntervalMicroseconds });
const captures = [];
for (const implementation of implementations) {
  globalThis.gc?.();
  const initialLoad = loadavg();
  await post('Profiler.start');
  const start = performance.now();
  for (let index = 0; index < profileCompilations; index++) compile(implementation);
  const elapsedMs = performance.now() - start;
  const { profile } = await post('Profiler.stop');
  const file = `${implementation.name}.cpuprofile`;
  const bytes = JSON.stringify(profile);
  writeFileSync(resolve(outputDirectory, file), bytes);
  const settings = { cwd: implementation.compilerRoot, encoding: 'utf8' };
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], settings).trim(), implementation.revision);
  assert.equal(execFileSync('git', ['status', '--porcelain'], settings).trim(), '');
  const { emit, compilerRoot, ...provenance } = implementation;
  captures.push({ ...provenance, file, sha256: createHash('sha256').update(bytes).digest('hex'),
    elapsedMs, initialLoad, finalLoad: loadavg(), samples: profile.samples?.length ?? 0 });
}
session.disconnect();
console.log(JSON.stringify({
  schemaVersion: 1, sourceSha256, sourceBytes: Buffer.byteLength(source), members: count,
  warmupCountPerSide: warmupCount, profileCompilationsPerSide: profileCompilations, samplingIntervalMicroseconds,
  harnessSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  method: 'One process; rotate both graphs during warmup, then sample baseline and candidate separately; GC before each profile.',
  limitation: 'Shared-host CPU sampling locates work; profile wall times are not benchmark samples.',
  captures,
}, null, 2));
```
