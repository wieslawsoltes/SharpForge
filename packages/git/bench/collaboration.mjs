import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { spawnSync } from 'node:child_process';
import { SequenceCrdt } from '../src/collab/crdt.js';
import { encodeCollaborationSnapshot } from '../src/collab/encoding.js';
import { profileCollaborationAllocations } from './collaboration-allocations.js';

const iterations = Number(process.argv[2] ?? 20);
if (!Number.isInteger(iterations) || iterations < 3 || iterations > 1000) throw new RangeError('Use 3 through 1000 benchmark iterations');
const make = actorId => new SequenceCrdt({ actorId, workspaceId: 'benchmark', documentId: 'Program.cs' });
const summarize = values => {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = percent => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1)];
  return { samples: values.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), maximumMs: sorted.at(-1) };
};
const cold = [];
const warm = [];
const snapshot = [];
const warmHeap = [];
let snapshotBytes = 0;
for (let iteration = 0; iteration < iterations; iteration++) {
  globalThis.gc?.();
  const start = performance.now();
  const document = make('actor');
  document.insert(0, '0123456789'.repeat(100));
  cold.push(performance.now() - start);
  let reference = document.text;
  const beforeHeap = process.memoryUsage().heapUsed;
  for (let operation = 0; operation < 1000; operation++) {
    const offset = (operation * 7919) % (document.length + 1);
    const deleteCount = operation % 3 === 0 && offset < document.length ? 1 : 0;
    const text = operation % 3 === 0 ? '' : String.fromCharCode(97 + operation % 26);
    const began = performance.now();
    document.replace(offset, deleteCount, text);
    document.anchorAt(Math.min(offset, document.length));
    warm.push(performance.now() - began);
    reference = reference.slice(0, offset) + text + reference.slice(offset + deleteCount);
  }
  globalThis.gc?.();
  warmHeap.push(process.memoryUsage().heapUsed - beforeHeap);
  if (reference !== document.text) throw new Error('Benchmark correctness gate failed');
  const receiver = make('receiver');
  const began = performance.now();
  await receiver.mergeSnapshot(document.snapshot());
  snapshot.push(performance.now() - began);
  if (receiver.text !== reference) throw new Error('Snapshot correctness gate failed');
  snapshotBytes = encodeCollaborationSnapshot(document.snapshot()).byteLength;
  document.dispose();
  receiver.dispose();
}
// Connecting and sampling the inspector happens only after every latency sample has been recorded.
let allocations;
try {
  allocations = await profileCollaborationAllocations(iterations);
  if (allocations.correctness.encodedSnapshotBytes !== snapshotBytes) {
    throw new Error('Allocation and latency workloads produced different snapshot sizes');
  }
} catch (error) {
  allocations = { ...allocations, status: 'failed', error: { name: error.name, code: error.code ?? null, message: error.message } };
  process.exitCode = 1;
}
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
process.stdout.write(JSON.stringify({
  benchmark: 'SF-A25 collaboration', commit: commit.status === 0 ? commit.stdout.trim() : null,
  node: process.version, v8: process.versions.v8, platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? 'unknown',
  backend: 'Node JavaScript RGA/AVL', correctness: 'reference string equality after each completed sample and snapshot union',
  coldCreate1000Utf16Units: summarize(cold), warmSingleUnitEditsAndAnchor: summarize(warm),
  initialSnapshotMerge: summarize(snapshot), encodedSnapshotBytes: snapshotBytes,
  retainedHeapDeltaBytes: warmHeap, heapMeasurement: globalThis.gc ? 'heapUsed before edits and after forced GC; net retained bytes, not total allocations'
    : 'heapUsed delta without forced GC; noisy retained heap estimate, not total allocations',
  allocations, ok: allocations.status === 'measured',
  baseline: 'new collaboration implementation; no pre-existing CRDT runtime to compare', iterations
}, null, 2) + '\n');
