import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {snapshotRetentionOptions} from '../bench/vm/snapshot-retention.js';
import {snapshotRetentionCensus, hostMemoryDifference, assessSnapshotRetention} from '../bench/vm/snapshot-retention-census.js';

test('retention protocol keeps exact workload size fixed and requires explicit bounded measurement options', () => {
  assert.deepEqual(snapshotRetentionOptions(['--runner', 'local', '--out', 'capture.json']),
    {runner: 'local', out: 'capture.json', scenario: 'all', maxRetainedMiB: 1536});
  for (const extra of [['--scenario', 'unknown'], ['--max-retained-mib', '32'], ['--max-retained-mib', '2049'],
    ['--max-retained-mib', '64.5'], ['--runner', 'again'], ['--payload-bytes', '1']]) {
    assert.throws(() => snapshotRetentionOptions(['--runner', 'local', '--out', 'capture.json', ...extra]));
  }
  assert.throws(() => snapshotRetentionOptions(['--runner', 'local']));
});

test('retention census counts unique immutable typed backing once and includes live storage separately', () => {
  const heap = new ManagedHeap(), reference = heap.array('byte', 16);
  heap.rootProvider = () => [reference];
  const first = heap.snapshot(), second = heap.snapshot();
  let census = snapshotRetentionCensus([first, second], heap.records);
  assert.equal(census.uniqueSnapshotRecords, 1);
  assert.equal(census.exactSnapshotTypedBackingBytes, 16);
  assert.equal(census.exactLiveAndSnapshotTypedBackingBytes, 32);
  assert.equal(census.snapshotRecordIndexSlots, 2);
  assert.equal(census.uniqueGenerationSlots, 1);
  heap.get(reference).data[0] = 1;
  census = snapshotRetentionCensus([first, second, heap.snapshot()], heap.records);
  assert.equal(census.uniqueSnapshotRecords, 2);
  assert.equal(census.uniqueSnapshotTypedBackings, 2);
  assert.equal(census.exactSnapshotTypedBackingBytes, 32);
  assert.equal(census.exactLiveAndSnapshotTypedBackingBytes, 48);
});

test('host assessment never double counts ArrayBuffers or passes a truncated history', () => {
  const sample = (heapUsed, external) => ({rss: 1000, heapTotal: 500, heapUsed, external, arrayBuffers: external});
  const row = {fixture: {managedLiveBytes: 100, typedPayloadBytes: 100}, snapshotsCaptured: 128,
    restoreEquivalence: {equal: true, revisions: 128}, host: {empty: sample(0, 0), live: sample(20, 100), retained: sample(30, 250)},
    census: {exactSnapshotTypedBackingBytes: 150, exactLiveAndSnapshotTypedBackingBytes: 250, logicalSnapshotEstimateBytes: 180}};
  assert.equal(hostMemoryDifference(row.host.retained, row.host.live).external, 150);
  const assessment = assessSnapshotRetention(row);
  assert.equal(assessment.hostSnapshotDeltaBytes, 160);
  assert.equal(assessment.hostCombinedDeltaBytes, 280);
  assert.equal(assessment.status, 'met-for-this-workload');
  assert.equal(assessSnapshotRetention({...row, snapshotsCaptured: 127}).status, 'incomplete');
  assert.equal(assessSnapshotRetention({...row, restoreEquivalence: {equal: false, revisions: 128}}).status, 'restore-mismatch');
  assert.equal(assessSnapshotRetention({...row, census: {...row.census, exactSnapshotTypedBackingBytes: 200}}).status,
    'missed-for-this-workload');
  assert.equal(assessSnapshotRetention({...row, host: {...row.host, retained: sample(70, 250)}}).status,
    'missed-for-this-workload', 'The bound is strictly less than two, not less than or equal');
});
