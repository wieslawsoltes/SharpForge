/** Fixed-source before/after compilation benchmark for extension metadata planning; run revisions serially. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const count = Number(option('--members', 32)), sampleCount = Number(option('--samples', 20)), warmupCount = 3;
assert(Number.isInteger(count) && count >= 4 && count <= 128, '--members must be within 4..128');
assert(Number.isInteger(sampleCount) && sampleCount >= 10 && sampleCount <= 40, '--samples must be within 10..40');
const { compileToReferenceAssembly } = await import(pathToFileURL(compilerEntry));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'packages'], { cwd: compilerRoot, encoding: 'utf8' }).trim();
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
const results = cases.map(({ name, source }) => {
  for (let iteration = 0; iteration < warmupCount; iteration++) compile(source);
  const samples = Array.from({ length: sampleCount }, () => measure(source));
  assert.equal(new Set(samples.map(sample => sample.outputBytes)).size, 1, 'Output size changed between identical compilations');
  return { name, sourceBytes: Buffer.byteLength(source), sourceSha256: createHash('sha256').update(source).digest('hex'),
    elapsedMs: summary(samples.map(sample => sample.elapsedMs)), heapUsedDeltaBytes: summary(samples.map(sample => sample.heapUsedDeltaBytes)),
    outputBytes: samples[0].outputBytes, samples };
});
console.log(JSON.stringify({
  schemaVersion: 1, revision, dirtyPackages: !!dirty, compilerEntry,
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  membersPerCase: count, sampleCount, warmupCount, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Complete compileToReferenceAssembly on identical closed-reference source in each revision',
  provenance: 'Shared host; machine-wide resource wrapper and serial team validation slot; no claim of host isolation.',
  memoryMetric: 'Signed post-compilation heapUsed difference; includes any GC during compilation and is not an allocation count or peak heap.',
  initialLoad, finalLoad: loadavg(), cases: results,
}, null, 2));
