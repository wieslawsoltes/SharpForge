import {ManagedHeap} from '@sharpforge/runtime';

export const retentionSnapshots = 128;
export const retentionPayloadBytes = 10_000_000;
export const retentionScenarios = Object.freeze(['original-records', 'concentrated-bytes', 'distributed-bytes']);

/** Preserve the existing record-based fixture separately from exact one-percent byte mutations. */
export function createRetentionFixture(scenario) {
  if (!retentionScenarios.includes(scenario)) throw new RangeError('Unknown snapshot retention scenario');
  const maximum = 64 * 1024 * 1024;
  const heap = new ManagedHeap({maxBytes: maximum, initialThreshold: maximum}), roots = [];
  heap.rootProvider = () => roots;
  if (scenario === 'original-records') {
    for (let index = 0; index < 4096; index++) {
      const text = heap.string(String(index).padStart(6, '0') + 'x'.repeat(1250));
      roots.push(heap.object('object', [text, 0]));
    }
  } else {
    for (let index = 0; index < 100; index++) roots.push(heap.array('byte', retentionPayloadBytes / 100));
  }
  const changedRecords = scenario === 'original-records' ? Math.ceil(heap.stats.liveObjects / 100)
    : scenario === 'concentrated-bytes' ? 1 : 100;
  const description = {
    scenario, managedLiveBytes: heap.stats.liveBytes, liveRecords: heap.stats.liveObjects,
    typedPayloadBytes: scenario === 'original-records' ? 0 : retentionPayloadBytes,
    mutationUnit: scenario === 'original-records' ? 'record' : 'payload byte', changedRecordsPerSnapshot: changedRecords,
    changedPayloadBytesPerSnapshot: scenario === 'original-records' ? null : retentionPayloadBytes / 100,
    originalScalarSlotsWrittenPerSnapshot: scenario === 'original-records' ? changedRecords : null,
    recordMutationFraction: changedRecords / heap.stats.liveObjects,
    byteMutationFraction: scenario === 'original-records' ? null : 0.01,
    pattern: scenario === 'original-records'
      ? 'Original 4096 immutable strings plus 4096 two-slot objects; rotate through 82 object scalar slots per snapshot.'
      : scenario === 'concentrated-bytes'
        ? 'Rewrite all 100000 bytes in the same one of 100 equally sized records before every snapshot.'
        : 'Rewrite the same first 1000 bytes in every one of 100 equally sized records before every snapshot.'
  };
  return {heap, roots, description, mutate(revision) {
    if (!Number.isInteger(revision) || revision < 0 || revision >= retentionSnapshots) throw new RangeError('Invalid snapshot revision');
    if (scenario === 'original-records') {
      for (let index = 0; index < changedRecords; index++) {
        heap.get(roots[(revision * changedRecords + index) % roots.length]).data[1] = revision + 1;
      }
    } else if (scenario === 'concentrated-bytes') heap.get(roots[0]).data.fill(revision + 1);
    else for (const root of roots) heap.get(root).data.fill(revision + 1, 0, 1000);
  }};
}
