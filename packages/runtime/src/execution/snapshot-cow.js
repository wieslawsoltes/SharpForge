import {copyExecution, immutableExecutionIdentity} from './execution-copy.js';
import {ReadonlySnapshotArray, sharedSnapshotRecord} from './snapshot-buffers.js';

function immutableValue(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return typeof value !== 'function';
  if (immutableExecutionIdentity(value) || value instanceof ReadonlySnapshotArray) return true;
  if (!Object.isFrozen(value) || value instanceof Map || value instanceof Set) return false;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.values(value).every(item => immutableValue(item, seen));
}

function shareableRecord(record) {
  for (const [key, value] of Object.entries(record)) {
    if (key === 'data') {
      if (record.kind === 'string' || ArrayBuffer.isView(value)) continue;
      if (!value.every(item => immutableValue(item))) return false;
    } else if (!immutableValue(value)) return false;
  }
  return true;
}

function recordCopy(record, memo, share) {
  const copy = {};
  memo.set(record, copy);
  for (const [key, value] of Object.entries(record)) {
    copy[key] = key === 'data' && ArrayBuffer.isView(value)
      ? new ReadonlySnapshotArray(value)
      : copyExecution(value, memo);
  }
  if (!share) return copy;
  if (Array.isArray(copy.data)) Object.freeze(copy.data);
  Object.defineProperty(copy, sharedSnapshotRecord, {value: true});
  return Object.freeze(copy);
}

function equalValue(left, right, pairs, reverse, depth = 0) {
  if (Object.is(left, right)) return true;
  if (depth > 128 || left === null || right === null
      || typeof left !== 'object' || typeof right !== 'object') return false;
  if (right instanceof ReadonlySnapshotArray) return right.equals(left);
  if (pairs.has(left) || reverse.has(right)) {
    return pairs.get(left) === right && reverse.get(right) === left;
  }
  pairs.set(left, right);
  reverse.set(right, left);
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!equalValue(left[index], right[index], pairs, reverse, depth + 1)) return false;
    }
    return true;
  }
  let leftCount = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;
    leftCount++;
    if (!Object.hasOwn(right, key) || !equalValue(left[key], right[key], pairs, reverse, depth + 1)) return false;
  }
  let rightCount = 0;
  for (const key in right) if (Object.hasOwn(right, key)) rightCount++;
  return leftCount === rightCount;
}

function unchangedRecord(record, cached, memo, pairs, reverse) {
  if (cached?.record !== record || cached.version !== record.version) return false;
  // Legacy host integrations can retain heap.get(...).data. Comparing immutable
  // payloads at capture catches such writes without adding proxies to VM loads.
  pairs.clear();
  reverse.clear();
  if (!equalValue(record, cached.snapshot, pairs, reverse)) return false;
  // A changed record copied earlier can already own part of this alias graph.
  // Reuse only if its copies agree, then seed the memo for later records.
  for (const [live, saved] of pairs) {
    if (memo.has(live) && memo.get(live) !== saved) return false;
  }
  for (const [live, saved] of pairs) memo.set(live, saved);
  return true;
}

/** Capture changed records once; immutable copies survive later heap mutations. */
export function snapshotHeap(heap, {memo = new Map(), shared = true} = {}) {
  const records = new Array(heap.records.length);
  const pairs = new Map();
  const reverse = new Map();
  let reusedRecords = 0;
  let copiedRecords = 0;
  for (let index = 0; index < records.length; index++) {
    const record = heap.records[index];
    if (!record) {
      records[index] = null;
      heap.snapshotRecords.delete(index);
      continue;
    }
    const cached = heap.snapshotRecords.get(index);
    if (shared && unchangedRecord(record, cached, memo, pairs, reverse)) {
      records[index] = cached.snapshot;
      reusedRecords++;
      continue;
    }
    const share = shared && shareableRecord(record);
    const snapshot = recordCopy(record, memo, share);
    records[index] = snapshot;
    copiedRecords++;
    if (share) heap.snapshotRecords.set(index, {record, version: record.version, snapshot});
    else heap.snapshotRecords.delete(index);
  }
  for (const index of heap.snapshotRecords.keys()) {
    if (index >= records.length) heap.snapshotRecords.delete(index);
  }
  heap.lastSnapshot = {reusedRecords, copiedRecords};
  if (!shared || heap.snapshotGenerationCounter !== heap.generationCounter || !heap.snapshotGenerations) {
    heap.snapshotGenerations = Object.freeze([...heap.generations]);
    heap.snapshotGenerationCounter = heap.generationCounter;
  }
  return {
    generationCounter: heap.generationCounter,
    handles: copyExecution([...heap.handles], memo),
    nextHandleId: heap.nextHandleId,
    records,
    generations: heap.snapshotGenerations,
    free: [...heap.free],
    stats: {...heap.stats},
    threshold: heap.threshold
  };
}

function mutableData(data, memo) {
  if (memo.has(data)) return memo.get(data);
  if (data instanceof ReadonlySnapshotArray) {
    const copy = data.toMutableArray();
    memo.set(data, copy);
    return copy;
  }
  if (Array.isArray(data) && Object.isFrozen(data)) {
    const copy = [];
    memo.set(data, copy);
    for (const value of data) copy.push(copyExecution(value, memo));
    return copy;
  }
  // The full-copy/prepared graph is already independent. Copying its backing
  // again would split self references and aliases shared by other records.
  return data;
}

/** Restore fresh mutable backing while snapshots keep their immutable records. */
export function restoreHeap(heap, snapshot, {memo = new Map(), prepared = false} = {}) {
  const state = prepared ? snapshot : copyExecution(snapshot, memo);
  heap.mutationRevision++;
  heap.generationCounter = Math.max(heap.generationCounter, state.generationCounter ?? 0);
  heap.handles = new Map(state.handles ?? []);
  heap.nextHandleId = Math.max(heap.nextHandleId, state.nextHandleId ?? 1);
  heap.snapshotRecords.clear();
  heap.snapshotGenerations = null;
  const backingCopies = new Map();
  heap.records = state.records.map(record => {
    if (!record) return null;
    const methodTable = record.methodTable?.registry === heap.methodTables
      ? record.methodTable
      : heap.methodTables.get(record.methodTable?.name ?? record.type);
    const live = {...record, methodTable, data: mutableData(record.data, backingCopies)};
    heap.ownRecord(live);
    return live;
  });
  heap.generations = [...state.generations];
  heap.free = [...state.free];
  heap.stats = {...state.stats};
  heap.threshold = state.threshold;
}
