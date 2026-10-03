import {isReference} from './reference.js';

export const heapSnapshotSchemaVersion = 2;

const services = Object.freeze(['collector', 'lifetime', 'spaces', 'limits', 'settings', 'notifications', 'pressure',
  'events', 'allocationSites', 'diagnostics', 'rootRegistry', 'gcStress', 'barriers', 'background', 'safepoints', 'counters']);

function immutableIdentity(value) {
  if (!Object.isFrozen(value)) return false;
  return isReference(value) || Object.hasOwn(value, 'owner') || Reflect.ownKeys(value).length === 0;
}

/** In-memory copy preserving graph aliases, callback/token identity and exact numeric values. */
export function copyHeapState(value, memo = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (memo.has(value)) return memo.get(value);
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    memo.set(value, copy);
    return copy;
  }
  if (ArrayBuffer.isView(value)) {
    const buffer = copyHeapState(value.buffer, memo);
    const copy = value instanceof DataView ? new DataView(buffer, value.byteOffset, value.byteLength)
      : new value.constructor(buffer, value.byteOffset, value.length);
    memo.set(value, copy);
    return copy;
  }
  if (value instanceof Map || value instanceof Set) {
    const copy = value instanceof Map ? new Map() : new Set();
    memo.set(value, copy);
    if (value instanceof Map) {
      for (const [key, item] of value) copy.set(copyHeapState(key, memo), copyHeapState(item, memo));
    } else {
      for (const item of value) copy.add(copyHeapState(item, memo));
    }
    return copy;
  }
  if (value instanceof Error) {
    const copy = Object.create(Object.getPrototypeOf(value));
    memo.set(value, copy);
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (Object.hasOwn(descriptor, 'value')) descriptor.value = copyHeapState(descriptor.value, memo);
      Object.defineProperty(copy, key, descriptor);
    }
    return copy;
  }
  if (immutableIdentity(value)) return value;
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  memo.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = copyHeapState(value[key], memo);
  return copy;
}

function metadataMemo(heap, records) {
  const memo = new Map([[heap.handleOwner, heap.handleOwner]]);
  for (const record of records) {
    if (record?.methodTable) memo.set(record.methodTable, record.methodTable);
    if (record?.descriptor) memo.set(record.descriptor, record.descriptor);
  }
  return memo;
}

function retainServiceIdentities(state, memo) {
  const retain = value => {
    if (value !== null && typeof value === 'object') memo.set(value, value);
  };
  for (const [, entry] of state.handles ?? []) retain(entry.ownerTag);
  for (const entry of state.allocationContexts ?? []) retain(entry.context);
  for (const [, entry] of state.services?.rootRegistry?.providers ?? []) retain(entry.owner);
  for (const [owner] of state.services?.spaces?.frozen?.dataSources ?? []) retain(owner);
  const lifetime = state.services?.lifetime;
  if (!lifetime) return memo;
  for (const [, entry] of lifetime.tables ?? []) retain(entry.table);
  for (const [, entry] of lifetime.resources?.entries ?? []) {
    retain(entry.resource);
    retain(entry.ownerTag);
  }
  for (const [, entry] of lifetime.handles?.entries ?? []) retain(entry.ownerTag);
  for (const [, entry] of lifetime.pins?.leases ?? []) retain(entry.ownerTag);
  retain(lifetime.finalizers?.context?.active?.runner);
  return memo;
}

/** Capture every collector service. Snapshots are scoped to their original heap instance. */
export function snapshotHeap(heap) {
  const memo = metadataMemo(heap, heap.records);
  const state = {schemaVersion: heapSnapshotSchemaVersion, owner: heap.handleOwner,
    generationCounter: heap.generationCounter, mutationRevision: heap.mutationRevision,
    exactAllocations: String(heap.allocatedBytes64 ?? BigInt(Math.trunc(heap.stats.allocatedBytes))),
    nextHandleId: heap.nextHandleId, records: heap.records, generations: heap.generations,
    free: heap.free, handles: [...heap.handles], pins: heap.pins, stats: {...heap.stats},
    maxBytes: heap.maxBytes, initialThreshold: heap.initialThreshold, threshold: heap.threshold,
    maxArrayLength: heap.maxArrayLength, closed: heap.closed,
    legacyMarkers: {marks: heap.marks, markEpoch: heap.markEpoch, markWork: heap.markWork},
    allocationContexts: [...heap.allocationContexts ?? []].map(context => ({context, state: context.snapshot()})),
    handleTable: heap.handleTable.snapshot(), services: {}};
  for (const name of services) {
    const service = heap[name];
    if (service?.snapshot) state.services[name] = service.snapshot();
  }
  return copyHeapState(state, retainServiceIdentities(state, memo));
}

function unsigned(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid heap snapshot ${name}`);
}

function validateRecords(heap, state) {
  if (!Array.isArray(state.records) || !Array.isArray(state.generations) || !Array.isArray(state.free)) {
    throw new TypeError('Invalid heap snapshot table');
  }
  if (state.records.length !== state.generations.length || state.records.length >= 0xffffffff) {
    throw new TypeError('Invalid heap snapshot table length');
  }
  const free = new Set();
  for (const index of state.free) {
    unsigned(index, 'free slot');
    if (index >= state.records.length || state.records[index] !== null || free.has(index)) {
      throw new TypeError('Invalid or duplicate heap free slot');
    }
    free.add(index);
  }
  let objects = 0;
  let bytes = 0;
  for (let index = 0; index < state.records.length; index++) {
    unsigned(state.generations[index], 'identity');
    const record = state.records[index];
    if (record === null) continue;
    if (!record || typeof record.kind !== 'string' || typeof record.type !== 'string') throw new TypeError('Invalid heap snapshot record');
    if (record.kind === 'string' ? typeof record.data !== 'string' : !Array.isArray(record.data)) {
      throw new TypeError('Invalid heap snapshot record data');
    }
    unsigned(record.size, 'record size');
    if (record.size > heap.maxBytes || state.generations[index] === 0) throw new TypeError('Invalid live heap snapshot record');
    if (record.gcGeneration !== undefined && ![0, 1, 2].includes(record.gcGeneration)) throw new TypeError('Invalid GC generation');
    bytes += record.size;
    objects++;
  }
  if (!state.stats || state.stats.liveObjects !== objects || state.stats.liveBytes !== bytes) {
    throw new TypeError('Heap snapshot accounting does not match its records');
  }
  if (bytes > heap.maxBytes) throw new RangeError('Heap snapshot exceeds the current memory budget');
}

function validateHandles(state) {
  if (!Array.isArray(state.handles) || !Array.isArray(state.pins)) throw new TypeError('Invalid heap snapshot roots');
  const ids = new Set();
  for (const entry of state.handles) {
    if (!Array.isArray(entry) || entry.length !== 2 || !entry[1] || typeof entry[1] !== 'object') {
      throw new TypeError('Invalid heap snapshot host handle');
    }
    unsigned(entry[0], 'host handle identity');
    if (entry[0] === 0 || entry[0] >= state.nextHandleId || ids.has(entry[0])) throw new TypeError('Invalid host handle sequence');
    ids.add(entry[0]);
  }
}

function validateTable(heap, state) {
  if (state?.version !== 1 || state.maxIdentity !== heap.handleTable.maxIdentity
    || !Array.isArray(state.highWater) || !Array.isArray(state.retired)) throw new TypeError('Invalid handle table snapshot');
  for (const value of state.highWater) {
    if (value !== undefined) unsigned(value, 'high-water identity');
  }
  for (const index of state.retired) unsigned(index, 'retired identity');
  heap.handleTable.validateSnapshot?.(state);
}

function validateContexts(heap, contexts) {
  if (!Array.isArray(contexts)) throw new TypeError('Missing allocation contexts');
  const unique = new Set();
  for (const entry of contexts) {
    const {context, state} = entry ?? {};
    if (!context || context.heap !== heap || typeof context.restore !== 'function' || unique.has(context)) {
      throw new TypeError('Invalid allocation context identity');
    }
    unique.add(context);
    if (!state || state.budget !== context.budget || state.threadId !== context.threadId || typeof state.closed !== 'boolean') {
      throw new TypeError('Invalid allocation context configuration');
    }
    unsigned(state.remaining, 'context remainder');
    unsigned(state.refills, 'context refills');
    if (typeof state.bytes !== 'bigint' || state.bytes < 0n) throw new TypeError('Invalid context allocation counter');
  }
}

/** All structural checks and external-resource guards run before publishing any restored state. */
export function validateHeapSnapshot(heap, state) {
  if (state?.schemaVersion !== heapSnapshotSchemaVersion) throw new TypeError('Unsupported heap snapshot schema version');
  if (state.owner !== heap.handleOwner) throw new TypeError('Heap snapshot belongs to another heap');
  for (const key of ['generationCounter', 'mutationRevision', 'nextHandleId', 'threshold', 'maxBytes']) unsigned(state[key], key);
  unsigned(state.initialThreshold, 'initialThreshold');
  unsigned(state.maxArrayLength, 'maxArrayLength');
  if (!state.initialThreshold || state.maxArrayLength > 0x7fffffff) throw new TypeError('Invalid heap snapshot configuration');
  if (state.threshold < 1 || state.threshold > heap.maxBytes || state.nextHandleId < 1) throw new TypeError('Invalid heap snapshot limits');
  if (typeof state.exactAllocations !== 'string' || !/^(0|[1-9][0-9]*)$/.test(state.exactAllocations)
    || state.exactAllocations.length > 1000) throw new TypeError('Invalid exact allocation counter');
  validateRecords(heap, state);
  validateHandles(state);
  validateTable(heap, state.handleTable);
  for (let index = 0; index < state.generations.length; index++) {
    if (state.generations[index] > (state.handleTable.highWater[index] ?? 0)) throw new TypeError('Identity exceeds its high-water mark');
  }
  validateContexts(heap, state.allocationContexts);
  if (typeof state.closed !== 'boolean' || !state.legacyMarkers || !(state.legacyMarkers.marks instanceof Uint32Array)) {
    throw new TypeError('Invalid heap lifecycle or marker state');
  }
  if (!state.services || typeof state.services !== 'object') throw new TypeError('Heap snapshot is missing collector services');
  for (const name of services) {
    const service = heap[name];
    if (!service?.snapshot) continue;
    if (!Object.hasOwn(state.services, name)) throw new TypeError(`Heap snapshot is missing ${name}`);
    if (!service.restore) throw new TypeError(`Heap service ${name} does not support restoration`);
    const current = service.snapshot();
    const saved = state.services[name];
    if (!saved || typeof saved !== 'object') throw new TypeError(`Invalid ${name} snapshot`);
    if (current?.version !== undefined && saved.version !== current.version) throw new TypeError(`Unsupported ${name} snapshot version`);
    service.validateSnapshot?.(saved);
    service.assertRestorable?.(saved);
  }
  return state;
}

function publishState(heap, state, monotonic) {
  const copy = copyHeapState(state, retainServiceIdentities(state, metadataMemo(heap, state.records)));
  heap.records = copy.records;
  heap.generations = copy.generations;
  heap.free = copy.free;
  heap.handles = new Map(copy.handles);
  heap.pins = copy.pins;
  heap.generationCounter = Math.max(monotonic.generationCounter, copy.generationCounter);
  heap.nextHandleId = Math.max(monotonic.nextHandleId, copy.nextHandleId);
  heap.mutationRevision = Math.max(monotonic.mutationRevision, copy.mutationRevision) + 1;
  const savedAllocations = BigInt(copy.exactAllocations);
  heap.allocatedBytes64 = monotonic.allocatedBytes64 > savedAllocations ? monotonic.allocatedBytes64 : savedAllocations;
  heap.restoreStats(copy.stats);
  heap.threshold = copy.threshold;
  heap.initialThreshold = copy.initialThreshold;
  heap.closed = copy.closed;
  heap.maxArrayLength = copy.maxArrayLength;
  heap.marks = copy.legacyMarkers.marks;
  heap.markEpoch = copy.legacyMarkers.markEpoch;
  heap.markWork = copy.legacyMarkers.markWork;
  for (const record of heap.records) {
    if (!record) continue;
    if (record.methodTable?.registry !== heap.methodTables) record.methodTable = heap.methodTables.get(record.methodTable?.name ?? record.type);
    record.descriptor = heap.describe(record.kind, record.methodTable, record.data);
  }
  heap.handleTable.restore(copy.handleTable);
  const contexts = new Set(copy.allocationContexts.map(entry => entry.context));
  for (const context of heap.allocationContexts ?? []) if (!contexts.has(context)) context.dispose();
  heap.allocationContexts = contexts;
  for (const entry of copy.allocationContexts) entry.context.restore(entry.state);
  for (const name of services) {
    if (Object.hasOwn(copy.services, name)) heap[name].restore(copy.services[name]);
  }
}

/** Rewind logical execution while retaining monotonic identity/allocation high-water marks. */
export function restoreHeap(heap, state) {
  validateHeapSnapshot(heap, state);
  const previous = snapshotHeap(heap);
  const monotonic = {generationCounter: heap.generationCounter, nextHandleId: heap.nextHandleId,
    mutationRevision: heap.mutationRevision, allocatedBytes64: heap.allocatedBytes64 ?? 0n};
  try {
    publishState(heap, state, monotonic);
  } catch (failure) {
    try {
      publishState(heap, previous, monotonic);
    } catch (rollback) {
      throw new AggregateError([failure, rollback], 'Heap snapshot restoration and rollback both failed');
    }
    throw failure;
  }
}
