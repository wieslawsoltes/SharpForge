import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../../packages/runtime/src/heap.js';

// Run only as part of the complete E01 qualification batch: node --expose-gc ...
assert.equal(typeof global.gc, 'function', 'Run with --expose-gc to measure retained allocations');
const heap = new ManagedHeap({maxBytes: 64 * 1024 * 1024, initialThreshold: 64 * 1024 * 1024});
const roots = [];
heap.rootProvider = () => roots;
const decoder = new TextDecoder();
for (let index = 0; index < 4096; index++) {
  const bytes = new TextEncoder().encode(String(index).padStart(6, '0') + 'x'.repeat(1250));
  const text = heap.string(decoder.decode(bytes));
  roots.push(heap.object('object', [text, 0]));
}
assert(heap.stats.liveBytes >= 10 * 1024 * 1024);
const sampleMemory = () => { global.gc(); return process.memoryUsage(); };
const before = sampleMemory();
const snapshots = [], captures = [];
const mutationCount = Math.ceil(heap.stats.liveObjects / 100);
for (let revision = 0; revision < 128; revision++) {
  for (let index = 0; index < mutationCount; index++) {
    heap.writeData(roots[(revision * mutationCount + index) % roots.length], 1, revision + 1);
  }
  const start = performance.now();
  snapshots.push(heap.snapshot());
  captures.push({revision, milliseconds: performance.now() - start, ...heap.lastSnapshot});
}
const after = sampleMemory();
const unique = new Set(snapshots.flatMap(snapshot => snapshot.records).filter(Boolean));
const generations = new Set(snapshots.map(snapshot => snapshot.generations));
const retainedPayloadBytes = [...unique].reduce((total, record) => total + record.size, 0)
  + snapshots.reduce((total, snapshot) => total + snapshot.records.length * 8, 0)
  + [...generations].reduce((total, data) => total + data.length * 8, 0);
function digest(snapshot) {
  const hash = createHash('sha256');
  for (const reference of roots) {
    const record = snapshot.records[reference.h];
    const text = snapshot.records[record.data[0].h].data;
    hash.update(text + ':' + record.data[1] + '\n');
  }
  return hash.digest('hex');
}
const replay = [];
for (let index = 0; index < snapshots.length; index++) {
  const saved = snapshots[index], start = performance.now();
  heap.restore(saved);
  const actual = digest(heap.snapshot({shared: false}));
  assert.equal(actual, digest(saved));
  replay.push({index, milliseconds: performance.now() - start, sha256: actual});
}
const result = {
  task: 'SF-A05-T06.2', timestamp: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  node: process.version, platform: process.platform, architecture: process.arch,
  heapBytes: heap.stats.liveBytes, objects: heap.stats.liveObjects, snapshots: snapshots.length,
  mutatedRecordsPerSnapshot: mutationCount, changedSlotsPerRecord: 1,
  retainedPayloadBytes, retainedPayloadRatio: retainedPayloadBytes / heap.stats.liveBytes,
  hostMemory: {before, after, retainedDelta: after.heapUsed + after.arrayBuffers - before.heapUsed - before.arrayBuffers},
  captures, replay, passed: retainedPayloadBytes < heap.stats.liveBytes * 2
};
const output = process.argv[2];
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
assert(result.passed, '128 captures exceeded twice the managed heap payload');
