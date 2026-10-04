/** Snapshot wrappers each own exactly one private copied buffer; ordinary views are deduplicated by ArrayBuffer identity. */
export function snapshotRetentionCensus(snapshots, liveRecords = []) {
  const records = new Set(), sequences = new Set(), buffers = new Set(), generations = new Set();
  let recordManagedBytes = 0, ordinarySlots = 0, typedBytes = 0, typedBackings = 0, indexSlots = 0;
  const addData = data => {
    if (sequences.has(data)) return;
    sequences.add(data);
    if (data?.readonlySnapshotArray === true) {
      typedBytes += data.byteLength;
      typedBackings++;
    } else if (ArrayBuffer.isView(data)) {
      if (!buffers.has(data.buffer)) {
        buffers.add(data.buffer);
        typedBytes += data.buffer.byteLength;
        typedBackings++;
      }
    } else if (Array.isArray(data)) ordinarySlots += data.length;
  };
  for (const snapshot of snapshots) {
    indexSlots += snapshot.records.length;
    generations.add(snapshot.generations);
    for (const record of snapshot.records) {
      if (!record || records.has(record)) continue;
      records.add(record);
      recordManagedBytes += record.size;
      addData(record.data);
    }
  }
  const snapshotTypedBytes = typedBytes, snapshotTypedBackings = typedBackings;
  for (const record of liveRecords) if (record) addData(record.data);
  const generationSlots = [...generations].reduce((total, array) => total + array.length, 0);
  return {
    uniqueSnapshotRecords: records.size, uniqueSnapshotTypedBackings: snapshotTypedBackings,
    exactSnapshotTypedBackingBytes: snapshotTypedBytes, exactLiveAndSnapshotTypedBackingBytes: typedBytes,
    uniqueLiveAndSnapshotTypedBackings: typedBackings,
    snapshotRecordIndexSlots: indexSlots, uniqueGenerationSlots: generationSlots,
    ordinaryDataSlotsIncludingLive: ordinarySlots, uniqueSnapshotManagedRecordBytes: recordManagedBytes,
    logicalSnapshotEstimateBytes: recordManagedBytes + (indexSlots + generationSlots) * 8,
    slotEstimateBytes: 8,
    limitations: 'Managed record sizes and eight-byte index slots are logical accounting, not V8 object sizes. ' +
      'String backing, ropes, object headers and Set/Map/Array overhead are measured only by post-GC host counters.'
  };
}

export function hostMemoryDifference(after, before) {
  return Object.fromEntries(['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']
    .map(key => [key, after[key] - before[key]]));
}

export function assessSnapshotRetention(row) {
  const denominator = row.fixture.managedLiveBytes;
  const delta = hostMemoryDifference(row.host.retained, row.host.live);
  const combined = hostMemoryDifference(row.host.retained, row.host.empty);
  const exact = row.census.exactSnapshotTypedBackingBytes;
  const complete = row.snapshotsCaptured === 128 && row.restoreEquivalence.revisions === 128;
  const hostRatio = (delta.heapUsed + delta.external) / denominator;
  const backingRatio = exact / denominator;
  const meets = hostRatio < 2 && backingRatio < 2;
  return {complete, assessmentBasis: 'Snapshot increment over the live baseline; combined live-plus-history is separate.',
    hostSnapshotDeltaBytes: delta.heapUsed + delta.external, hostSnapshotDeltaRatio: hostRatio,
    hostCombinedDeltaBytes: combined.heapUsed + combined.external,
    hostCombinedDeltaRatio: (combined.heapUsed + combined.external) / denominator,
    hostUnderTwiceManagedHeap: complete ? hostRatio < 2 : null,
    exactSnapshotBackingRatioToManagedHeap: backingRatio,
    logicalSnapshotRatio: row.census.logicalSnapshotEstimateBytes / denominator,
    exactTypedPayloadRatio: row.fixture.typedPayloadBytes ? exact / row.fixture.typedPayloadBytes : null,
    exactLiveAndSnapshotTypedPayloadRatio: row.fixture.typedPayloadBytes
      ? row.census.exactLiveAndSnapshotTypedBackingBytes / row.fixture.typedPayloadBytes : null,
    restoreEquivalent: row.restoreEquivalence.equal === true,
    status: !complete ? 'incomplete' : !row.restoreEquivalence.equal ? 'restore-mismatch'
      : meets ? 'met-for-this-workload' : 'missed-for-this-workload'};
}
