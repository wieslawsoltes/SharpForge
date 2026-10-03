import {isReference} from './managed-fault.js';
import {primitiveArrayConstructor} from './array-storage.js';
import {snapshotMemoryValue} from './memory-snapshot-values.js';
import {ReadonlySnapshotArray} from './snapshot-buffers.js';

const fail = message => { throw new TypeError('Invalid memory snapshot: ' + message); };
const sameReference = (left, right) => left?.h === right?.h && left?.g === right?.g;
const terminal = new Set(['completed', 'faulted', 'canceled']);
const metadataKeys = new Set(['method', 'offsets', 'vmOwner', 'owner', 'baseType', 'sourceType', 'elementType', 'valueType', 'nullableType']);

function capturedFrames(snapshot) {
  const frames = new Map();
  const add = frame => {
    if (frames.has(frame.id) && frames.get(frame.id) !== frame) fail('duplicate frame');
    frames.set(frame.id, frame);
  };
  for (const frame of snapshot.frames) add(frame);
  for (const [, context] of snapshot.scheduler?.contexts ?? []) {
    if (terminal.has(context.status) && !context.preserveFrames) continue;
    for (const frame of context.frames) add(frame);
  }
  return frames;
}

function capturedContext(vm, snapshot, frames) {
  const context = Object.create(vm);
  const handles = new Map(snapshot.heap.handles ?? []);
  const heap = Object.create(vm.heap);
  heap.get = reference => {
    if (!isReference(reference) || reference.heapOwner !== undefined && reference.heapOwner !== vm.heap.handleOwner) fail('reference ownership');
    const record = snapshot.heap.records[reference.h];
    if (!record || snapshot.heap.generations[reference.h] !== reference.g) fail('stale memory owner');
    return record;
  };
  heap.getHandle = handle => {
    if (handle?.owner !== vm.heap.handleOwner) fail('pin handle ownership');
    return handles.get(handle.id)?.value ?? null;
  };
  Object.assign(context, {heap, frames: snapshot.frames, frameIndex: frames, statics: snapshot.statics, valueLayouts: new Map()});
  return {context, handles};
}

function frameMemory(context, snapshot, handles) {
  const sequence = snapshot.memorySequence ?? 0;
  if (!Number.isSafeInteger(sequence) || sequence < 0) fail('allocation identity');
  const identities = new Set();
  const buffers = new Set();
  let bytes = 0;
  const identity = id => {
    if (!Number.isSafeInteger(id) || id < 1 || id > sequence || identities.has(id)) fail('memory identity');
    identities.add(id);
  };
  for (const frame of context.frameIndex.values()) {
    if (frame.stackRegions !== undefined && !(frame.stackRegions instanceof Map)) fail('stack region map');
    for (const [id, region] of frame.stackRegions ?? []) {
      identity(id);
      const data = region?.bytes;
      if (!(data instanceof Uint8Array) || data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength || buffers.has(data.buffer)) {
        fail('stack bytes or region alias');
      }
      buffers.add(data.buffer);
      bytes += data.byteLength;
    }
    if (frame.pinLeases !== undefined && !(frame.pinLeases instanceof Map)) fail('pin lease map');
    for (const [index, lease] of frame.pinLeases ?? []) {
      if (!Number.isInteger(index) || index < 0 || index >= frame.locals.length || lease?.active !== true) fail('pin local');
      identity(lease.id);
      const handle = handles.get(lease.handle?.id);
      if (lease.handle?.owner !== context.heap.handleOwner || !handle || handle.weak || !sameReference(handle.value, lease.owner)) {
        fail('pin handle ownership');
      }
      const record = context.heap.get(lease.owner);
      if (record.kind !== 'array' || !primitiveArrayConstructor(record.methodTable.elementType) ||
          !Number.isSafeInteger(record.data.byteLength)) fail('pin requires primitive array storage');
    }
  }
  if (!Number.isSafeInteger(bytes) || bytes > (context.options?.maxStackMemoryBytes ?? 1024 * 1024)) fail('stack memory budget');
}

function walkValues(context, roots, heapStorage, seen) {
  const pending = [...roots];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value.registry && value.flags || value === context.snapshotOwner || value === context.heap.handleOwner ||
        ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof ReadonlySnapshotArray) continue;
    snapshotMemoryValue(context, value, {heapStorage});
    if (isReference(value)) { context.heap.get(value); continue; }
    if (value instanceof Map) for (const [key, item] of value) pending.push(key, item);
    else if (value instanceof Set) pending.push(...value);
    else for (const [key, item] of Object.entries(value)) if (!metadataKeys.has(key)) pending.push(item);
  }
}

/** Validate the captured graph only; running heap contents never decide replay validity. */
export function validateMemorySnapshot(vm, snapshot) {
  const frames = capturedFrames(snapshot);
  const {context, handles} = capturedContext(vm, snapshot, frames);
  frameMemory(context, snapshot, handles);
  // Heap/static storage must never acquire stack-only wrappers, including through aggregates.
  const stored = snapshot.heap.records.filter(Boolean).map(record => record.data);
  walkValues(context, [...stored, snapshot.statics], true, new Set());
  const live = [snapshot.stack, snapshot.returnValue, ...frames.values()];
  for (const [, item] of snapshot.scheduler?.contexts ?? []) {
    if (!terminal.has(item.status) || item.preserveFrames) live.push(item.stack, item.result, item.resumeValue);
  }
  walkValues(context, live, false, new Set());
}
