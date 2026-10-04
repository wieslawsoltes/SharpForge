/** Paired fixed-source comparison of two clean, independent compiler graphs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}
const count = Number(option('--members', 32));
const sampleCount = Number(option('--samples', 20));
const warmupCount = 80;
assert(Number.isInteger(count) && count >= 4 && count <= 128, '--members must be within 4..128');
assert(Number.isInteger(sampleCount) && sampleCount >= 10 && sampleCount <= 40, '--samples must be within 10..40');
const implementations = [];
for (const name of ['baseline', 'candidate']) {
  const entry = option(`--${name}-entry`);
  assert(entry, `--${name}-entry is required`);
  const compilerEntry = resolve(entry);
  const compilerRoot = resolve(dirname(compilerEntry), '../../..');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
  assert.equal(dirty, '', `${name} worktree must be clean`);
  const module = await import(pathToFileURL(compilerEntry));
  implementations.push({ name, compilerEntry, compilerRoot, revision, dirtyWorktree: false, emit: module.compileToReferenceAssembly });
}
assert.notEqual(implementations[0].emit, implementations[1].emit, 'The two compiler entry points must be distinct graphs');
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
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
function compile(entry) {
  const result = entry.implementation.emit(entry.source, {
    name: 'ExtensionMetadataBenchmark', outputKind: 'library', langVersion: '14',
  });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert(result.assembly instanceof Uint8Array);
  return result.assembly;
}
function measure(entry, round, position) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const assembly = compile(entry);
  const elapsedMs = performance.now() - start;
  const heapUsedDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  return { round, position, elapsedMs, heapUsedDeltaBytes, outputBytes: assembly.length };
}
const entries = cases.flatMap(workload => implementations.map(implementation => ({ ...workload, implementation, samples: [] })));
const indices = entries.map((_, index) => index);
const initialLoad = loadavg();
for (let round = 0; round < warmupCount; round++) {
  const order = round % 2 ? indices.toReversed() : indices;
  for (const index of order) compile(entries[index]);
}
const measurementInitialLoad = loadavg();
for (let round = 0; round < sampleCount; round++) {
  const order = round % 2 ? indices.toReversed() : indices;
  for (const [position, index] of order.entries()) {
    entries[index].samples.push(measure(entries[index], round, position));
  }
}
for (const implementation of implementations) {
  const settings = { cwd: implementation.compilerRoot, encoding: 'utf8' };
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], settings).trim(), implementation.revision, 'Compiler revision changed');
  assert.equal(execFileSync('git', ['status', '--porcelain'], settings).trim(), '', 'Compiler worktree changed');
}
const results = entries.map(({ name, source, implementation, samples }) => {
  assert.equal(new Set(samples.map(sample => sample.outputBytes)).size, 1, 'Output size changed across identical compilations');
  return {
    name, implementation: implementation.name, sourceBytes: Buffer.byteLength(source),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    elapsedMs: summary(samples.map(sample => sample.elapsedMs)),
    heapUsedDeltaBytes: summary(samples.map(sample => sample.heapUsedDeltaBytes)),
    outputBytes: samples[0].outputBytes, samples,
  };
});
console.log(JSON.stringify({
  schemaVersion: 3,
  implementations: implementations.map(({ emit, compilerRoot, ...provenance }) => provenance),
  harnessSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  membersPerCase: count, sampleCountPerCase: sampleCount, warmupCountPerCase: warmupCount,
  warmupStrategy: '80 rounds over both independent graphs and all workloads, reversing traversal on odd rounds',
  sampleStrategy: '20 rounds over all workloads and both graphs, reversing traversal on odd rounds; one compilation per sample',
  gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Complete compileToReferenceAssembly on identical closed-reference source in both compiler graphs',
  provenance: 'Shared host; one Node process, resource wrapper and serial team slot; no claim of host isolation.',
  memoryMetric: 'Signed post-compilation heapUsed difference; includes GC during compilation; neither allocation count nor peak heap.',
  initialLoad, measurementInitialLoad, finalLoad: loadavg(), cases: results,
}, null, 2));
