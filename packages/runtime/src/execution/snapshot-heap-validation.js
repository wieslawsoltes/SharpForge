import {isReference} from './managed-fault.js';
import {ownsHeapReference} from './heap-reference.js';
import {heapDataBytes, isSnapshotSequence} from './snapshot-buffers.js';
import {primitiveArrayConstructor} from './array-storage.js';
import {validateArrayShape} from './arrays.js';
import {snapshotInteger as integer, invalidSnapshot as fail, snapshotPairs} from './snapshot-validation-helpers.js';

/** Validate accounting, generations and record backing against the destination's heap quota. */
export function validateSnapshotHeap(vm, snapshot) {
  const heap = snapshot.heap;
  if (!heap || !Array.isArray(heap.records) || !Array.isArray(heap.generations) ||
      heap.generations.length !== heap.records.length || !Array.isArray(heap.free) ||
      !heap.stats || !integer(heap.generationCounter) || !Number.isFinite(heap.threshold) ||
      heap.threshold < 0 || heap.threshold > vm.heap.maxBytes) fail('heap');
  snapshotPairs(heap.handles ?? [], 'heap handles');
  if (!integer(heap.nextHandleId) || heap.nextHandleId < 1) fail('heap handle identity counter');
  const free = new Set();
  for (const index of heap.free) {
    if (!integer(index) || index >= heap.records.length || heap.records[index] !== null || free.has(index)) fail('heap free list');
    free.add(index);
  }
  let liveBytes = 0, liveObjects = 0, strong = 0, weak = 0;
  for (let index = 0; index < heap.records.length; index++) {
    const record = heap.records[index];
    if (record === null) { if (!free.has(index)) fail('missing free record'); continue; }
    if (!record || typeof record.kind !== 'string' || typeof record.type !== 'string' ||
        !integer(record.size) || !integer(heap.generations[index]) || heap.generations[index] === 0 ||
        heap.generations[index] > heap.generationCounter) fail('heap record');
    const valid = record.kind === 'string' ? typeof record.data === 'string'
      : record.kind === 'array' ? isSnapshotSequence(record.data) : Array.isArray(record.data);
    if (!valid) fail('heap data');
    const size = record.kind === 'string' ? 24 + record.data.length * 2 : 32 + heapDataBytes(record.data);
    if (record.size !== size || record.methodTable?.registry !== vm.heap.methodTables ||
        vm.heap.methodTables.tables.get(record.methodTable.name) !== record.methodTable) fail('heap record size or type identity');
    if (record.kind === 'array') {
      validateArrayShape(record);
      const constructor = primitiveArrayConstructor(record.methodTable.elementType);
      const actual = record.data.readonlySnapshotArray ? record.data.typedArrayName : record.data.constructor.name;
      if (constructor ? actual !== constructor.name : !Array.isArray(record.data)) fail('array backing element type');
      if (record.data.length > vm.heap.maxArrayLength) fail('array length quota');
    }
    liveBytes += size;
    liveObjects++;
  }
  for (const [id, handle] of heap.handles ?? []) {
    if (!integer(id) || id < 1 || id >= heap.nextHandleId || !handle || typeof handle.weak !== 'boolean') fail('heap handle');
    if (handle.weak) weak++; else strong++;
  }
  if (!integer(liveBytes) || liveBytes !== heap.stats.liveBytes || liveObjects !== heap.stats.liveObjects ||
      liveBytes > vm.heap.maxBytes || heap.stats.hostStrongHandles !== strong || heap.stats.hostWeakHandles !== weak) fail('heap accounting');
  return reference => {
    if (!isReference(reference) || !integer(reference.h) || !integer(reference.g) || reference.g === 0 ||
        !ownsHeapReference(vm.heap, reference) || heap.generations[reference.h] !== reference.g || !heap.records[reference.h]) {
      fail('managed reference ownership or generation');
    }
    return heap.records[reference.h];
  };
}
