import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {Builtins, createBuiltinRegistry} from '@sharpforge/bytecode';

// Run the same file in each revision with: node --expose-gc scripts/benchmarks/a00-builtin-registry-sparse.mjs
const snapshotCount = 5;
const sampleCount = 5;
const maximumBuiltin = Builtins.reduce((maximum, entry) => entry && entry.id > maximum.id ? entry : maximum);
const builtinOwnIndexCount = Object.keys(Builtins).length;

function sample() {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const registry = createBuiltinRegistry();
  const snapshots = [];
  for (let index = 0; index < snapshotCount; index++) snapshots.push(registry.entries);
  const elapsedMs = performance.now() - started;
  globalThis.gc?.();
  const heapUsedDeltaBytes = process.memoryUsage().heapUsed - heapBefore;

  // Inspect only after timing and heap measurement, while every snapshot and the registry remain live.
  if (registry.get(maximumBuiltin.name) !== maximumBuiltin ||
      snapshots.some(snapshot => snapshot[maximumBuiltin.id] !== maximumBuiltin)) {
    throw new Error('Default builtin registry did not retain the highest builtin ID');
  }
  const snapshotOwnIndexCounts = snapshots.map(snapshot => Object.keys(snapshot).length);
  return {
    elapsedMs,
    heapUsedDeltaBytes,
    snapshotOwnIndexCounts,
    retainedSnapshotOwnPropertyCount: snapshotOwnIndexCounts.reduce((total, count) => total + count + 1, 0)
  };
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

sample();
const samples = Array.from({length: sampleCount}, sample);
console.log(JSON.stringify({
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  gcAvailable: typeof globalThis.gc === 'function',
  warmupCount: 1,
  sampleCount,
  retainedSnapshotsPerSample: snapshotCount,
  builtinArrayLength: Builtins.length,
  builtinOwnIndexCount,
  maximumBuiltinId: maximumBuiltin.id,
  elapsedMs: summarize(samples.map(row => row.elapsedMs)),
  heapUsedDeltaBytes: summarize(samples.map(row => row.heapUsedDeltaBytes)),
  notes: 'Heap deltas retain one registry and five snapshots; own property totals include each array length. Timing excludes GC and inspection.',
  samples
}, null, 2));
