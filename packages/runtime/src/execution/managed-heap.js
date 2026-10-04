import {MethodTableRegistry} from './method-table.js';
import {ManagedFault, isReference} from './managed-fault.js';
import {collectHeap} from './heap-collection.js';
import {heapStamp, heapCensus, inspectHeapRecord, inspectHeapPage, inspectHeap, heapRetentionPath} from './heap-inspection.js';
import {snapshotHeap, restoreHeap} from './snapshot-cow.js';
import {arrayElementBytes, primitiveArrayStorage, isArrayStorage, storageWrite, cloneArrayStorage} from './array-storage.js';
import {heapDataBytes} from './snapshot-buffers.js';

const recordBytes = (kind, data) => kind === 'string' ? 24 + data.length * 2 : 32 + heapDataBytes(data);

/** Precise non-moving heap with generation-checked handles and explicit mutations. */
export class ManagedHeap {
  constructor(options = {}) {
    const {maxBytes = 32 * 1024 * 1024, initialThreshold = 64 * 1024,
      methodTables = new MethodTableRegistry()} = options;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1
        || !Number.isSafeInteger(initialThreshold) || initialThreshold < 1) {
      throw new RangeError('Heap sizes must be positive safe integers');
    }
    const maxArrayLength = options.maxArrayLength ?? 0xffffffff;
    if (!Number.isSafeInteger(maxArrayLength) || maxArrayLength < 0) throw new RangeError('Invalid maxArrayLength');
    this.methodTables = methodTables;
    this.observer = null;
    this.maxBytes = maxBytes;
    this.maxArrayLength = maxArrayLength;
    this.threshold = Math.min(initialThreshold, maxBytes);
    this.mutationRevision = 0;
    this.recordVersion = 0;
    this.generationCounter = 0;
    this.records = [];
    this.generations = [];
    this.free = [];
    this.rootProvider = () => [];
    this.pins = [];
    this.handles = new Map();
    this.handleOwner = Object.freeze({});
    this.nextHandleId = 1;
    this.marks = new Uint32Array(0);
    this.markEpoch = 0;
    this.markWork = [];
    this.snapshotRecords = new Map();
    this.lastSnapshot = {copiedRecords: 0, reusedRecords: 0};
    this.stats = {
      allocatedBytes: 0, hostStrongHandles: 0, hostWeakHandles: 0, rootsScanned: 0,
      edgesScanned: 0, markedObjects: 0, maxPauseMs: 0, markMs: 0, sweepMs: 0,
      liveBytes: 0, liveObjects: 0, allocations: 0, collections: 0, freedObjects: 0,
      freedBytes: 0, lastPauseMs: 0, totalPauseMs: 0, peakBytes: 0
    };
  }

  withRoots(values, action) {
    const start = this.pins.length;
    for (const value of values) this.pins.push(value);
    try {
      return action();
    } finally {
      this.pins.length = start;
    }
  }

  createHandle(value, {weak = false} = {}) {
    if (isReference(value)) this.get(value);
    else if (weak) throw new TypeError('Weak handles require a managed reference');
    const id = this.nextHandleId++;
    if (!Number.isSafeInteger(id)) throw new RangeError('Handle identity exhausted');
    const handle = Object.freeze({id, owner: this.handleOwner});
    this.handles.set(id, {value, weak});
    this.stats[weak ? 'hostWeakHandles' : 'hostStrongHandles']++;
    return handle;
  }

  getHandle(handle) {
    if (handle?.owner !== this.handleOwner) return null;
    const item = this.handles.get(handle.id);
    if (!item) return null;
    const value = item.value;
    if (item.weak && isReference(value) && (this.generations[value.h] !== value.g || !this.records[value.h])) return null;
    return value;
  }

  releaseHandle(handle) {
    if (handle?.owner !== this.handleOwner || !this.handles.has(handle.id)) return false;
    const item = this.handles.get(handle.id);
    this.handles.delete(handle.id);
    this.stats[item.weak ? 'hostWeakHandles' : 'hostStrongHandles']--;
    return true;
  }

  reserve(bytes, roots = []) {
    if (bytes > this.maxBytes || bytes < 0 || !Number.isSafeInteger(bytes)) {
      throw new ManagedFault('OutOfMemoryException', 'The managed allocation exceeds the heap budget');
    }
    if (this.stats.liveBytes + bytes > this.threshold) this.collect(roots);
    if (this.stats.liveBytes + bytes > this.maxBytes) {
      throw new ManagedFault('OutOfMemoryException', 'Managed heap budget exhausted');
    }
  }

  /** Register a newly allocated/restored record without exposing the owner in snapshots. */
  ownRecord(record) {
    Object.defineProperty(record, 'heapOwner', {value: this.handleOwner});
    record.version = ++this.recordVersion;
    return record;
  }

  allocate(kind, type, data, roots = []) {
    const size = recordBytes(kind, data);
    const methodTable = this.methodTables.get(type);
    const typeName = typeof type === 'string' ? type : methodTable.name;
    const allocationRoots = (function* () {
      yield* roots;
      if (kind !== 'string') yield* data;
    })();
    this.reserve(size, allocationRoots);
    const generation = this.generationCounter + 1;
    if (!Number.isSafeInteger(generation)) {
      throw new ManagedFault('OutOfMemoryException', 'Managed reference identity exhausted');
    }
    this.generationCounter = generation;
    const handle = this.free.length ? this.free.pop() : this.records.length;
    this.generations[handle] = generation;
    this.records[handle] = this.ownRecord({kind, type: typeName, methodTable, data, size});
    this.snapshotRecords.delete(handle);
    this.mutationRevision++;
    this.stats.allocatedBytes += size;
    this.stats.liveBytes += size;
    this.stats.liveObjects++;
    this.stats.allocations++;
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.stats.liveBytes);
    if (this.observer) this.observer.allocation(size, typeName, kind);
    return Object.freeze(Object.defineProperty({h: handle, g: generation}, 'heapOwner', {value: this.handleOwner}));
  }

  /** Mark a bulk mutation before returning its live backing storage. */
  ensureWritable(referenceOrRecord) {
    const record = isReference(referenceOrRecord) ? this.get(referenceOrRecord) : referenceOrRecord;
    if (record?.heapOwner !== this.handleOwner || record.kind === 'string') {
      throw new TypeError('A mutable record owned by this heap is required');
    }
    record.version = ++this.recordVersion;
    this.mutationRevision++;
    return record.data;
  }

  writeData(referenceOrRecord, index, value) {
    const record = isReference(referenceOrRecord) ? this.get(referenceOrRecord) : referenceOrRecord;
    if (!Number.isSafeInteger(index) || index < 0 || index >= record?.data?.length) {
      throw new RangeError('Managed record slot is out of bounds');
    }
    return storageWrite(this.ensureWritable(record), index, value);
  }

  replaceData(reference, data) {
    const record = this.get(reference);
    if (!isArrayStorage(data) || record.kind === 'string') throw new TypeError('Array-backed record required');
    const size = recordBytes(record.kind, data);
    const delta = size - record.size;
    if (delta > 0) this.reserve(delta, [reference, ...data]);
    this.stats.liveBytes += delta;
    this.stats.allocatedBytes += Math.max(0, delta);
    this.stats.peakBytes = Math.max(this.stats.peakBytes, this.stats.liveBytes);
    this.ensureWritable(record);
    record.data = cloneArrayStorage(data);
    record.size = size;
    if (delta > 0 && this.observer) this.observer.allocation(delta, record.type, record.kind, true);
  }

  string(value, roots = []) {
    return this.allocate('string', 'string', String(value), roots);
  }

  object(type, fields) {
    return this.allocate('object', type, fields);
  }

  array(type, length) {
    const exact = typeof length === 'bigint' ? length : Number.isSafeInteger(length) ? BigInt(length) : null;
    if (exact === null || exact < 0n) throw new ManagedFault('OverflowException', 'Array length must be non-negative');
    const element = this.methodTables.get(type);
    const capacity = Math.min(this.maxArrayLength, 0xffffffff,
      Math.floor(Math.max(0, this.maxBytes - 32) / arrayElementBytes(element)));
    if (exact > BigInt(capacity)) throw new ManagedFault('OutOfMemoryException', 'Array exceeds the configured heap capacity');
    const count = Number(exact);
    this.reserve(32 + count * arrayElementBytes(element));
    const name = typeof type === 'string' ? type : element.name;
    return this.allocate('array', name + '[]', primitiveArrayStorage(element, count));
  }

  get(reference) {
    if (reference === null || reference === undefined) {
      throw new ManagedFault('NullReferenceException', 'Object reference not set to an instance of an object');
    }
    if (!isReference(reference) || reference.heapOwner !== undefined && reference.heapOwner !== this.handleOwner
        || this.generations[reference.h] !== reference.g || !this.records[reference.h]) {
      throw new ManagedFault('InvalidReferenceException', 'Stale or invalid managed reference');
    }
    return this.records[reference.h];
  }

  collect(extraRoots = []) { return collectHeap(this, extraRoots); }
  snapshot(options = {}) { return snapshotHeap(this, options); }
  restore(snapshot, options = {}) { return restoreHeap(this, snapshot, options); }
  census() { return heapCensus(this); }
  stamp() { return heapStamp(this); }
  inspectPage(options = {}) { return inspectHeapPage(this, options); }
  inspectRecord(handle, record) { return inspectHeapRecord(this, handle, record); }
  retentionPath(reference, options = {}) { return heapRetentionPath(this, reference, options); }
  inspect(limit = 200) { return inspectHeap(this, limit); }
}
