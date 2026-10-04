import {ManagedFault} from './fault.js';
import {recordSize} from './sizing.js';
import {accountAllocation} from './stats.js';
import {rootReference} from './reference.js';

const noRoots = Object.freeze([]);

function requireOpenHeap(heap) {
  if (heap.closed) throw new ManagedFault('ObjectDisposedException', 'Managed heap is closed');
}

function createRecord(heap, kind, type, data, options) {
  if (typeof kind !== 'string' || typeof data?.length !== 'number'
    || (kind !== 'string' && !Array.isArray(data) && !ArrayBuffer.isView(data))) {
    throw new TypeError('Managed records require a string or indexed array payload');
  }
  const methodTable = heap.methodTables.get(type);
  const descriptor = heap.describe(kind, methodTable, data);
  return {
    kind, type: typeof type === 'string' ? type : methodTable.name, methodTable, data,
    descriptor, size: recordSize(descriptor, data.length), gcGeneration: 0, age: 0,
    space: 'small', pinCount: 0, allocationId: heap.generationCounter + 1,
    allocationSite: options.allocationSite ?? null, storage: null
  };
}

/** Inputs are rooted before reserve; failed preparation never publishes a handle. */
export function allocateManaged(heap, kind, type, data, roots = noRoots, options = {}) {
  requireOpenHeap(heap);
  const record = createRecord(heap, kind, type, data, options);
  const start = heap.pins.length;
  try {
    for (const value of roots) heap.pinRoot(value);
    heap.visitEdges(record, heap._pinEdge);
    if (heap.gcStress.enabled) heap.gcStress.beforeAllocation(noRoots, record.allocationSite);
    if (options.allocationContext) options.allocationContext.reserve(record.size);
    else heap.reserve(record.size);
    heap.limits.allocationFailureRetry(() => {
      requireOpenHeap(heap);
      return heap.spaces.prepare(record, options);
    });
    let reference;
    try {
      reference = heap.handleTable.allocate(record);
      record.allocationId = heap.generationCounter;
    } catch (error) {
      heap.spaces.release(null, record);
      throw error;
    }
    accountAllocation(heap, record.size);
    heap.noteMutation();
    heap.spaces.allocated(reference);
    heap.collector.allocated(reference);
    // User observers and finalizer resolvers may allocate or collect before this call returns.
    heap.pinRoot(reference);
    heap.lifetime.allocated(reference, record);
    requireOpenHeap(heap);
    heap.settings.onAllocation(record.size, {space: record.space,
      threadId: options.allocationContext?.threadId ?? heap.currentThreadId()});
    if (heap.allocationSites.enabled) {
      heap.allocationSites.capture(record);
      requireOpenHeap(heap);
    }
    heap.spaces.emitPendingEvents();
    requireOpenHeap(heap);
    heap.events.allocationTick(reference, record);
    requireOpenHeap(heap);
    heap.background.allocated(reference);
    return reference;
  } catch (error) {
    requireOpenHeap(heap);
    throw error;
  } finally {
    if (heap.pins.length > start) heap.pins.length = start;
  }
}

/** Resizing is transactional and publishes new edges through the collector barrier. */
export function replaceManagedData(heap, reference, data) {
  requireOpenHeap(heap);
  const record = heap.get(reference);
  if (!Array.isArray(data) || record.kind === 'string') throw new TypeError('Array-backed record required');
  if (record.space === 'frozen') throw new ManagedFault('InvalidOperationException', 'Frozen storage is immutable');
  const descriptor = heap.describe(record.kind, record.methodTable, data);
  const nextSize = recordSize(descriptor, data.length);
  const previousSize = record.size;
  const delta = nextSize - previousSize;
  const start = heap.pins.length;
  let referenceStores = 0;
  try {
    heap.pinRoot(reference);
    for (const value of data) {
      heap._pinEdge(value);
      if (rootReference(value)) referenceStores++;
    }
    if (delta > 0) heap.reserve(delta);
    heap.limits.allocationFailureRetry(() => {
      requireOpenHeap(heap);
      return heap.spaces.replaceData(reference, record, data, {size: nextSize});
    });
    record.descriptor = descriptor;
    record.size = nextSize;
    if (delta > 0) accountAllocation(heap, delta, 0);
    else heap.stats.liveBytes += delta;
    const barrier = !heap.barriers.disabledSites?.has('bulk-copy');
    heap.collector.resized(reference, previousSize, {barrier});
    if (delta > 0) heap.settings.onAllocation(delta, {space: record.space, threadId: heap.currentThreadId()});
    heap.barriers.publishRange(reference, 0, data.length, 'bulk-copy', {barrier: false, referenceStores});
    if (data.length === 0) heap.noteMutation();
    heap.spaces.emitPendingEvents();
    requireOpenHeap(heap);
  } catch (error) {
    requireOpenHeap(heap);
    throw error;
  } finally {
    if (heap.pins.length > start) heap.pins.length = start;
  }
}

export function primitiveDefault(type) {
  if (type.name === 'System.Boolean') return false;
  if (type.name === 'System.Int64' || type.name === 'System.UInt64') return 0n;
  if (type.enumUnderlyingType) return primitiveDefault(type.enumUnderlyingType);
  if (type.flags.primitive || type.name === 'System.Decimal') return 0;
  return null;
}

export function allocateArray(heap, type, length, options = {}) {
  if (!Number.isInteger(length) || length < 0 || length > 0x7fffffff) {
    throw new ManagedFault('OverflowException', 'Array length must be a non-negative Int32');
  }
  if (length > heap.maxArrayLength) {
    throw new ManagedFault('OutOfMemoryException', 'Array length exceeds the configured managed element limit');
  }
  const element = heap.methodTables.get(type);
  const name = typeof type === 'string' ? type : element.name;
  const table = heap.methodTables.get(name + '[]');
  const size = recordSize(heap.describe('array', table, {length}), length);
  if (size > heap.maxBytes) throw new ManagedFault('OutOfMemoryException', 'Managed array exceeds the heap hard limit');
  return allocateManaged(heap, 'array', name + '[]', Array(length).fill(primitiveDefault(element)), noRoots, options);
}
