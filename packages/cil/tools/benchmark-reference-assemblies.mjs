import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const compilerPath = option('--compiler');
const { compileToReferenceAssembly } = await import(compilerPath ? pathToFileURL(compilerPath).href : '@sharpforge/compiler');
const source = readFileSync(new URL('../../../tests/fixtures/a03-reference-assemblies/surface.cs', import.meta.url), 'utf8');
const requested = option('--mode') ?? 'refout';
assert.ok(['refout', 'metadata'].includes(requested), 'Mode is refout or metadata');
const options = { name: 'RefSurface', allowUnsafe: true, ...(requested === 'refout' ? { refout: true } : {}) };
const coldStart = performance.now();
const cold = compileToReferenceAssembly(source, options);
const coldMs = performance.now() - coldStart;
assert.equal(cold.success, true, JSON.stringify(cold.diagnostics));
const samples = [];
const heapDeltas = [];
for (let index = 0; index < 120; index++) {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = compileToReferenceAssembly(source, options);
  const duration = performance.now() - started;
  heapDeltas.push(process.memoryUsage().heapUsed - before);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.assembly, cold.assembly);
  samples.push(duration);
}
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const report = {
  mode: requested, node: process.version, platform: process.platform, architecture: process.arch,
  cpu: cpus()[0]?.model, sourceBytes: Buffer.byteLength(source), assemblyBytes: cold.assembly.length, coldMs,
  medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), p99Ms: percentile(samples, 0.99),
  gcExposed: typeof globalThis.gc === 'function', medianHeapUsedDelta: percentile(heapDeltas, 0.5),
  memoryNote: 'Per-call heapUsed delta includes temporary allocations; this is not total allocation or retained-heap accounting.',
  samplesMs: samples, heapUsedDeltas: heapDeltas,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (option('--output')) writeFileSync(option('--output'), json);
console.log(json);
