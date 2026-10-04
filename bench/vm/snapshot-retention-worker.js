import {setImmediate} from 'node:timers/promises';
import {ManagedHeap} from '@sharpforge/runtime';
import {createRetentionFixture, retentionSnapshots, retentionScenarios} from './snapshot-retention-fixtures.js';
import {snapshotRetentionCensus, hostMemoryDifference, assessSnapshotRetention} from './snapshot-retention-census.js';
import {verifyRetentionRestores} from './snapshot-retention-equivalence.js';

async function collect() {
  for (let index = 0; index < 3; index++) {
    globalThis.gc();
    await setImmediate();
  }
}

async function memory() {
  await collect();
  return process.memoryUsage();
}

function warmCapture() {
  const heap = new ManagedHeap(), root = heap.array('byte', 64);
  heap.rootProvider = () => [root];
  const snapshot = heap.snapshot();
  heap.restore(snapshot);
  heap.snapshot({shared: false});
}

async function main() {
  const [scenario, capText] = process.argv.slice(2), cap = Number(capText);
  if (!retentionScenarios.includes(scenario) || !Number.isSafeInteger(cap) || cap < 64 * 1024 * 1024 || cap > 2 * 1024 ** 3) {
    throw new RangeError('Expected scenario and a 64 MiB..2 GiB host retention cap');
  }
  if (typeof globalThis.gc !== 'function') throw new Error('Snapshot retention measurement requires --expose-gc');
  warmCapture();
  const host = {empty: await memory()};
  let workload = createRetentionFixture(scenario);
  const fixture = workload.description, snapshots = [], progress = [];
  host.live = await memory();
  const started = performance.now();
  let stop = null, copiedRecords = 0, reusedRecords = 0;
  for (let revision = 0; revision < retentionSnapshots; revision++) {
    workload.mutate(revision);
    snapshots.push(workload.heap.snapshot());
    copiedRecords += workload.heap.lastSnapshot.copiedRecords;
    reusedRecords += workload.heap.lastSnapshot.reusedRecords;
    const current = process.memoryUsage();
    if ((revision + 1) % 16 === 0 || revision === 0 || current.heapUsed + current.external > cap) {
      const sample = await memory();
      progress.push({snapshots: snapshots.length, host: sample});
      if (sample.heapUsed + sample.external > cap) {
        stop = 'Post-GC heapUsed + external exceeded the explicit cap; remaining captures were not attempted.';
        break;
      }
    }
  }
  const captureWallMsIncludingExplicitGC = performance.now() - started;
  host.retained = await memory();
  const census = snapshotRetentionCensus(snapshots, workload.heap.records);
  const restoreEquivalence = await verifyRetentionRestores(scenario, snapshots, workload.heap, collect);
  const snapshotsCaptured = snapshots.length;
  snapshots.length = 0;
  host.historyReleasedAfterRestoreChecks = await memory();
  workload = null;
  host.allHeapsReleased = await memory();
  const row = {scenario, fixture, snapshotsRequested: retentionSnapshots, snapshotsCaptured, stop,
    explicitGC: {callsPerBoundary: 3, eventLoopTurnsPerBoundary: 3}, hostCapBytes: cap,
    host, progress, census, restoreEquivalence, copiedRecords, reusedRecords, captureWallMsIncludingExplicitGC,
    liveHostDelta: hostMemoryDifference(host.live, host.empty),
    retainedHostDelta: hostMemoryDifference(host.retained, host.live),
    totalLiveAndSnapshotHostDelta: hostMemoryDifference(host.retained, host.empty),
    unit: 'bytes', additiveHostMetric: 'heapUsed + external; arrayBuffers is already included in external and is not added again',
    environment: {node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch}};
  row.assessment = assessSnapshotRetention(row);
  process.stdout.write(JSON.stringify(row) + '\n');
}

await main();
