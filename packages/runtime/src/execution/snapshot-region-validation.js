import {primitiveArrayConstructor} from './array-storage.js';
import {snapshotResolutionContext} from './generic-snapshot.js';
import {sameSnapshotReference} from './snapshot-address-validation.js';
import {snapshotInteger as integer, invalidSnapshot as fail} from './snapshot-validation-helpers.js';

/** Own a private metadata cache; no captured location is resolved through the live frame index. */
export function capturedMemoryContext(vm, snapshot, frames, referenceRecord) {
  return {vm, snapshot, frames, referenceRecord, metadataVM: snapshotResolutionContext(vm)};
}

/** Allocation identities and strong pin handles must describe one coherent saved lifetime. */
export function validateSnapshotRegions(context) {
  const {vm, snapshot, frames, referenceRecord} = context;
  const sequence = snapshot.memorySequence ?? 0;
  if (!integer(sequence)) fail('memory allocation identity');
  const identities = new Set(), buffers = new Set(), handles = new Map(snapshot.heap.handles);
  const identity = id => {
    if (!integer(id) || id < 1 || id > sequence || identities.has(id)) fail('memory allocation identity');
    identities.add(id);
  };
  let bytes = 0;
  for (const frame of frames.values()) {
    if (frame.stackRegions !== undefined && !(frame.stackRegions instanceof Map)) fail('stack region map');
    for (const [id, region] of frame.stackRegions ?? []) {
      identity(id);
      const data = region?.bytes;
      if (!(data instanceof Uint8Array) || data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength || buffers.has(data.buffer)) {
        fail('stack region bytes or alias');
      }
      buffers.add(data.buffer);
      bytes += data.byteLength;
    }
    if (frame.pinLeases !== undefined && !(frame.pinLeases instanceof Map)) fail('pin lease map');
    for (const [index, lease] of frame.pinLeases ?? []) {
      if (!integer(index) || index >= frame.locals.length || lease?.active !== true) fail('pin local');
      identity(lease.id);
      const handle = handles.get(lease.handle?.id);
      if (!Object.isFrozen(lease.handle) || lease.handle?.owner !== vm.heap.handleOwner ||
          !handle || handle.weak || !sameSnapshotReference(handle.value, lease.owner)) fail('pin handle ownership');
      const record = referenceRecord(lease.owner);
      if (record.kind !== 'array' || !primitiveArrayConstructor(record.methodTable.elementType) || !integer(record.data.byteLength)) {
        fail('pin requires primitive array storage');
      }
    }
  }
  const limit = vm.options?.maxStackMemoryBytes ?? 1024 * 1024;
  if (!integer(limit) || !integer(bytes) || bytes > limit) fail('stack memory budget');
}
