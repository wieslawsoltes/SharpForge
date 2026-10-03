/** Run only as part of the complete E01 qualification batch, with --expose-gc. */
import {createHash} from 'node:crypto';
import {ManagedHeap} from '@sharpforge/runtime';
import {distribution, evidence, failure, publish, requireResult} from '../benchmarks/a05-evidence.mjs';

const report = evidence('SF-A05-T06.2 retained COW history', import.meta.filename);
report.workload = '4096 immutable strings plus 4096 object records, at least 10 MiB live payload; each revision changes one slot in 1% of live records. This is a record-mutation workload, not 1% of payload bytes.';
report.accounting = 'Managed record sizes plus 8-byte record/generation vector entries estimate retained snapshot payload. Measured host memory is also reported; implementation overhead and the live heap are separate.';
function sampleMemory() {
  global.gc();
  return process.memoryUsage();
}
function digest(snapshot, roots) {
  const hash = createHash('sha256');
  for (const reference of roots) {
    const record = snapshot.records[reference.h];
    const text = snapshot.records[record.data[0].h].data;
    hash.update(text + ':' + record.data[1] + '\n');
  }
  return hash.digest('hex');
}
try {
  requireResult(typeof global.gc === 'function', 'Run with --expose-gc to measure retained allocations');
  const heap = new ManagedHeap({maxBytes: 64 * 1024 * 1024, initialThreshold: 64 * 1024 * 1024});
  const roots = [];
  heap.rootProvider = () => roots;
  const decoder = new TextDecoder();
  for (let index = 0; index < 4096; index++) {
    const bytes = new TextEncoder().encode(String(index).padStart(6, '0') + 'x'.repeat(1250));
    const text = heap.string(decoder.decode(bytes));
    roots.push(heap.object('object', [text, 0]));
  }
  requireResult(heap.stats.liveBytes >= 10 * 1024 * 1024, 'COW workload is smaller than 10 MiB');
  const before = sampleMemory();
  const initialStats = {...heap.stats};
  const snapshots = [];
  report.captures = [];
  const mutationCount = Math.ceil(heap.stats.liveObjects / 100);
  for (let revision = 0; revision < 128; revision++) {
    for (let index = 0; index < mutationCount; index++) {
      heap.writeData(roots[(revision * mutationCount + index) % roots.length], 1, revision + 1);
    }
    const start = performance.now();
    snapshots.push(heap.snapshot());
    report.captures.push({revision, milliseconds: performance.now() - start, ...heap.lastSnapshot});
  }
  const after = sampleMemory();
  const unique = new Set(snapshots.flatMap(snapshot => snapshot.records).filter(Boolean));
  const generations = new Set(snapshots.map(snapshot => snapshot.generations));
  const retainedPayloadBytes = [...unique].reduce((total, record) => total + record.size, 0)
    + snapshots.reduce((total, snapshot) => total + snapshot.records.length * 8, 0)
    + [...generations].reduce((total, data) => total + data.length * 8, 0);
  Object.assign(report, {
    heapBytes: heap.stats.liveBytes, objects: heap.stats.liveObjects, snapshots: snapshots.length,
    mutatedRecordsPerSnapshot: mutationCount, changedSlotsPerRecord: 1,
    retainedPayloadBytes, retainedPayloadRatio: retainedPayloadBytes / heap.stats.liveBytes,
    managedCaptureAllocations: heap.stats.allocations - initialStats.allocations,
    managedCaptureAllocatedBytes: heap.stats.allocatedBytes - initialStats.allocatedBytes,
    hostMemory: {before, after, retainedDelta: after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers},
    captureFirstMs: report.captures[0].milliseconds,
    captureWarmMs: distribution(report.captures.slice(1).map(sample => sample.milliseconds))
  });
  report.replay = [];
  for (let index = 0; index < snapshots.length; index++) {
    const saved = snapshots[index];
    let start = performance.now();
    heap.restore(saved);
    const restoreMs = performance.now() - start;
    start = performance.now();
    const fullCopy = heap.snapshot({shared: false});
    const fullCopyMs = performance.now() - start;
    const actual = digest(fullCopy, roots);
    const expected = digest(saved, roots);
    report.replay.push({index, restoreMs, fullCopyMs, sha256: actual, expectedSha256: expected});
    requireResult(actual === expected, 'COW replay differs from the full-copy reference', {index, actual, expected});
  }
  report.restoreFirstMs = report.replay[0].restoreMs;
  report.restoreWarmMs = distribution(report.replay.slice(1).map(sample => sample.restoreMs));
  report.fullCopyFirstMs = report.replay[0].fullCopyMs;
  report.fullCopyWarmMs = distribution(report.replay.slice(1).map(sample => sample.fullCopyMs));
  requireResult(retainedPayloadBytes < heap.stats.liveBytes * 2, '128 captures exceeded twice the managed heap payload');
  report.passed = true;
} catch (error) {
  report.errors.push(failure(error));
} finally {
  publish(report, process.argv[2]);
}
