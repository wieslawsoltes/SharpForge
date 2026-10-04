import {recordAllocation} from './heap-allocation.js';
import {createHeapReference} from './heap-reference.js';
import {arrayStorageBytes, primitiveArrayConstructor, primitiveArrayStorage, normalizeArrayStorage} from './array-storage.js';

/** Size of owned payload, with exact primitive-array widths and a fixed record header. */
export function heapRecordSize(kind, data) {
  return kind === 'string' ? 24 + data.length * 2 : 32 + arrayStorageBytes(data);
}

/** Reserve before allocating host backing; references in inline values are roots during admission. */
export function allocateHeapRecord(heap, {kind, type, data, roots = []}, Fault) {
  const methodTable = heap.methodTables.get(type);
  const typeName = typeof type === 'string' ? type : methodTable.name;
  const element = kind === 'array' ? methodTable.elementType : null;
  const constructor = element && primitiveArrayConstructor(element);
  const size = constructor ? 32 + data.length * constructor.BYTES_PER_ELEMENT : heapRecordSize(kind, data);
  const allocationRoots = (function* () {
    yield* roots;
    if (kind !== 'string' && !ArrayBuffer.isView(data)) yield* data;
  })();
  heap.reserve(size, allocationRoots);
  if (element) data = normalizeArrayStorage(element, data);
  const generation = heap.generationCounter + 1;
  if (!Number.isSafeInteger(generation)) throw new Fault('OutOfMemoryException', 'Managed reference identity exhausted');
  heap.generationCounter = generation;
  const handle = heap.free.length ? heap.free.pop() : heap.records.length;
  heap.generations[handle] = generation;
  heap.records[handle] = {kind, type: typeName, methodTable, data, size};
  recordAllocation(heap, size);
  return createHeapReference(heap, handle, generation);
}

/** Standalone heap vector allocation uses a byte-derived limit instead of a fixed element cap. */
export function allocateHeapArray(heap, type, length, Fault) {
  const raw = length?.nativeInt ? length.value : length;
  if (typeof raw === 'bigint') {
    if (raw < 0n) throw new Fault('OverflowException', 'Array length must be nonnegative');
    if (raw > 0xffffffffn) throw new Fault('OutOfMemoryException', 'Array length exceeds host addressing');
    length = Number(raw);
  } else length = raw;
  if (!Number.isSafeInteger(length) || length < 0) throw new Fault('OverflowException', 'Array length must be a nonnegative integer');
  const element = heap.methodTables.get(type);
  const size = primitiveArrayConstructor(element)?.BYTES_PER_ELEMENT ?? 8;
  const capacity = Math.min(0xffffffff, Math.floor(Math.max(0, heap.maxBytes - 32) / size), heap.maxArrayLength);
  if (length > capacity) throw new Fault('OutOfMemoryException', 'Array length exceeds the configured heap capacity');
  heap.reserve(32 + length * size);
  const zero = element.name === 'System.Boolean' ? false : ['System.Int64', 'System.UInt64'].includes(element.name)
    ? 0n : element.flags.primitive ? 0 : null;
  return heap.allocate('array', (typeof type === 'string' ? type : element.name) + '[]', primitiveArrayStorage(element, length, zero));
}
