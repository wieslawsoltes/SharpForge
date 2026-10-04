import {copyExecution, immutableExecutionIdentity} from './execution-copy.js';
import {ReadonlySnapshotArray, sharedSnapshotRecord} from './snapshot-buffers.js';

const states = new WeakMap();
const emptyStatistics = Object.freeze({reusedRecords: 0, copiedRecords: 0});

function stateFor(heap) {
  let state = states.get(heap);
  if (!state) {
    state = {records: new WeakMap(), generations: null, statistics: emptyStatistics};
    states.set(heap, state);
  }
  return state;
}

function immutableValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (immutableExecutionIdentity(value) || value instanceof ReadonlySnapshotArray) return true;
  if (!Object.isFrozen(value) || value instanceof Map || value instanceof Set || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.values(value).every(item => immutableValue(item, seen));
}

function aliasedBacking(heap) {
  const views = new Map(), buffers = new Set();
  for (const record of heap.records) {
    const data = record?.data;
    if (!ArrayBuffer.isView(data)) continue;
    const previous = views.get(data.buffer);
    if (previous && previous !== data || data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength) buffers.add(data.buffer);
    views.set(data.buffer, data);
  }
  return buffers;
}

function shareableRecord(record) {
  for (const [key, value] of Object.entries(record)) {
    if (key === 'data') {
      if (record.kind === 'string' || ArrayBuffer.isView(value)) continue;
      if (!Array.isArray(value) || !value.every(item => immutableValue(item))) return false;
    } else if (!immutableValue(value)) return false;
  }
  return true;
}

function recordCopy(record, memo, share) {
  if (memo.has(record)) return memo.get(record);
  const copy = {};
  memo.set(record, copy);
  for (const [key, value] of Object.entries(record)) {
    if (key === 'data' && ArrayBuffer.isView(value) && share) {
      if (!memo.has(value)) memo.set(value, new ReadonlySnapshotArray(value));
      copy[key] = memo.get(value);
    } else copy[key] = copyExecution(value, memo);
  }
  if (!share) return copy;
  if (Array.isArray(copy.data)) Object.freeze(copy.data);
  Object.defineProperty(copy, sharedSnapshotRecord, {value: true});
  return Object.freeze(copy);
}

function equalValue(left, right, pairs, reverse, depth = 0) {
  if (Object.is(left, right)) return true;
  if (depth > 128 || left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (pairs.has(left) || reverse.has(right)) return pairs.get(left) === right && reverse.get(right) === left;
  pairs.set(left, right);
  reverse.set(right, left);
  if (right instanceof ReadonlySnapshotArray) return right.equals(left);
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (Object.hasOwn(left, index) !== Object.hasOwn(right, index)) return false;
      if (!equalValue(left[index], right[index], pairs, reverse, depth + 1)) return false;
    }
    return true;
  }
  let count = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;
    count++;
    if (!Object.hasOwn(right, key) || !equalValue(left[key], right[key], pairs, reverse, depth + 1)) return false;
  }
  return count === Object.keys(right).length;
}

function unchangedRecord(record, cached, memo) {
  if (!cached || cached.version !== record.version) return false;
  // Host code can retain heap.get(...).data. A stamp alone cannot prove that
  // those mutable arrays were not written, so the capture boundary compares them.
  const pairs = new Map(), reverse = new Map();
  if (!equalValue(record, cached.snapshot, pairs, reverse)) return false;
  for (const [live, saved] of pairs) if (memo.has(live) && memo.get(live) !== saved) return false;
  for (const [live, saved] of pairs) memo.set(live, saved);
  return true;
}

/** Diagnostic counts for the most recent capture; does not retain dead live records. */
export function heapSnapshotStatistics(heap) {
  return states.get(heap)?.statistics ?? emptyStatistics;
}

/** Immutable record versions share unchanged payloads; capture scans host-writable backing conservatively. */
export function snapshotHeap(heap, {memo = new Map(), shared = true} = {}) {
  const state = stateFor(heap), records = new Array(heap.records.length), aliased = shared ? aliasedBacking(heap) : null;
  // A host handle can retain a direct data/view alias. Capture it first so sharing
  // never disconnects that graph edge from a heap record's private saved bytes.
  const handles = copyExecution([...heap.handles], memo);
  let reusedRecords = 0, copiedRecords = 0;
  for (let index = 0; index < records.length; index++) {
    const record = heap.records[index];
    if (!record) { records[index] = null; continue; }
    const cached = state.records.get(record);
    const canShare = shared && !aliased.has(record.data?.buffer) && !memo.has(record) &&
      !memo.has(record.data) && !memo.has(record.data?.buffer);
    if (canShare && unchangedRecord(record, cached, memo)) {
      records[index] = cached.snapshot;
      reusedRecords++;
      continue;
    }
    const share = canShare && shareableRecord(record);
    const snapshot = recordCopy(record, memo, share);
    records[index] = snapshot;
    copiedRecords++;
    if (share) state.records.set(record, {version: record.version, snapshot});
    else state.records.delete(record);
  }
  state.statistics = Object.freeze({reusedRecords, copiedRecords});
  if (!shared || state.generations?.length !== heap.generations.length ||
      heap.generations.some((generation, index) => generation !== state.generations[index])) {
    state.generations = Object.freeze([...heap.generations]);
  }
  return {generationCounter: heap.generationCounter, handles,
    nextHandleId: heap.nextHandleId, records, generations: state.generations,
    free: [...heap.free], stats: {...heap.stats}, threshold: heap.threshold};
}

function mutableData(data, memo) {
  if (memo.has(data)) return memo.get(data);
  if (data instanceof ReadonlySnapshotArray) {
    const copy = data.toMutableArray();
    memo.set(data, copy);
    return copy;
  }
  if (!Array.isArray(data)) return copyExecution(data, memo);
  const copy = new Array(data.length);
  memo.set(data, copy);
  for (const [key, value] of Object.entries(data)) {
    Object.defineProperty(copy, key, {value: copyExecution(value, memo), enumerable: true, writable: true, configurable: true});
  }
  return copy;
}

/** Allocate the entire mutable heap graph before a restore can publish any of it. */
export function prepareHeapRestore(heap, snapshot, memo = new Map()) {
  const records = snapshot.records.map(record => {
    if (!record) return null;
    const copy = {};
    memo.set(record, copy);
    return copy;
  });
  for (let index = 0; index < records.length; index++) {
    const record = snapshot.records[index], copy = records[index];
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      copy[key] = key === 'data' ? mutableData(value, memo) : copyExecution(value, memo);
    }
    copy.methodTable = record.methodTable?.registry === heap.methodTables
      ? record.methodTable : heap.methodTables.get(record.methodTable?.name ?? record.type);
  }
  return {...snapshot, records, generations: [...snapshot.generations], free: [...snapshot.free],
    handles: copyExecution(snapshot.handles ?? [], memo), stats: {...snapshot.stats}};
}

/** Commit a detached heap image, preserving monotonic allocation and host-handle identities. */
export function restoreHeap(heap, snapshot, {memo = new Map(), prepared = false} = {}) {
  const state = prepared ? snapshot : prepareHeapRestore(heap, snapshot, memo);
  const handles = new Map(state.handles ?? []);
  const maximum = state.generationCounter ?? state.generations.reduce((value, generation) => Math.max(value, generation ?? 0), 0);
  heap.mutationRevision++;
  heap.generationCounter = Math.max(heap.generationCounter, maximum);
  heap.handles = handles;
  heap.nextHandleId = Math.max(heap.nextHandleId, state.nextHandleId ?? 1);
  heap.records = state.records;
  heap.generations = state.generations;
  heap.free = state.free;
  heap.stats = state.stats;
  heap.threshold = state.threshold;
  states.delete(heap);
}
