import {forEachValueReference} from './value-references.js';

export function heapStamp(heap) {
  return `${heap.mutationRevision}:${heap.generationCounter}:${heap.stats.collections}:${heap.stats.liveObjects}`;
}

export function inspectHeapRecord(heap, handle, record) {
  return {
    handle, generation: heap.generations[handle], type: record.type, kind: record.kind,
    size: record.size, length: record.data.length,
    preview: record.kind === 'string'
      ? record.data.slice(0, 120)
      : `${record.data.length} ${record.kind === 'array' ? 'elements' : 'fields'}`
  };
}

export function heapCensus(heap) {
  const counts = new Map();
  for (const record of heap.records) {
    if (!record) continue;
    const key = record.kind + ':' + record.type;
    let item = counts.get(key);
    if (!item) {
      item = {kind: record.kind, type: record.type, objects: 0, bytes: 0};
      counts.set(key, item);
    }
    item.objects++;
    item.bytes += record.size;
  }
  return {
    stamp: heapStamp(heap), objects: heap.stats.liveObjects, bytes: heap.stats.liveBytes,
    types: [...counts.values()].sort((a, b) => b.bytes - a.bytes || a.type.localeCompare(b.type))
  };
}

export function inspectHeapPage(heap, {afterHandle = -1, limit = 200, kind = null, type = null, stamp = null} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(afterHandle) || afterHandle < -1) {
    throw new RangeError('Invalid heap page request');
  }
  if (stamp !== null && stamp !== heapStamp(heap)) throw new Error('Heap changed; restart inspection from the first page');
  const items = [];
  let more = false;
  for (let handle = afterHandle + 1; handle < heap.records.length; handle++) {
    const record = heap.records[handle];
    if (!record || kind && record.kind !== kind || type && record.type !== type) continue;
    if (items.length === limit) {
      more = true;
      break;
    }
    items.push(inspectHeapRecord(heap, handle, record));
  }
  return {items, stamp: heapStamp(heap), next: more ? items.at(-1).handle : null, totalLiveObjects: heap.stats.liveObjects};
}

export function inspectHeap(heap, limit = 200) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 10000) throw new RangeError('Invalid heap inspection limit');
  const items = [];
  for (let handle = 0; handle < heap.records.length && items.length < limit; handle++) {
    const record = heap.records[handle];
    if (record) items.push(inspectHeapRecord(heap, handle, record));
  }
  return items;
}

/** Bounded breadth-first diagnostic traversal, independent of GC marking state. */
export function heapRetentionPath(heap, reference, {maxObjects = 20000, maxEdges = 200000} = {}) {
  heap.get(reference);
  if (!Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 1000000
      || !Number.isInteger(maxEdges) || maxEdges < 1 || maxEdges > 10000000) {
    throw new RangeError('Invalid retention-path budget');
  }
  const state = {queue: [], parents: new Map(), edges: 0, truncated: false};
  const add = (value, parent, label) => forEachValueReference(value, item => {
    if (item.heapOwner !== undefined && item.heapOwner !== heap.handleOwner) return;
    if (heap.generations[item.h] !== item.g || !heap.records[item.h] || state.parents.has(item.h)) return;
    if (state.parents.size >= maxObjects) {
      state.truncated = true;
      return;
    }
    state.parents.set(item.h, {parent, label, reference: item});
    state.queue.push(item.h);
  });
  let rootIndex = 0;
  for (const value of heap.rootProvider()) {
    add(value, null, `VM root ${rootIndex++}`);
    if (++state.edges >= maxEdges) {
      state.truncated = true;
      break;
    }
  }
  for (let index = 0; index < heap.pins.length && state.edges < maxEdges; index++, state.edges++) {
    add(heap.pins[index], null, `Temporary root ${index}`);
  }
  for (const [id, handle] of heap.handles) {
    if (state.edges++ >= maxEdges) {
      state.truncated = true;
      break;
    }
    if (!handle.weak) add(handle.value, null, `Strong host handle ${id}`);
  }
  walkRecords(heap, reference, state, add, maxEdges);
  const path = [];
  if (state.parents.has(reference.h)) {
    let handle = reference.h;
    while (handle !== null) {
      const step = state.parents.get(handle);
      path.push({reference: step.reference, label: step.label, type: heap.records[handle].type});
      handle = step.parent;
    }
    path.reverse();
  }
  return {reachable: path.length > 0, path, truncated: state.truncated,
    visited: state.parents.size, edgesScanned: state.edges, stamp: heapStamp(heap)};
}

function walkRecords(heap, reference, state, add, maxEdges) {
  for (let index = 0; index < state.queue.length && !state.parents.has(reference.h); index++) {
    const handle = state.queue[index];
    const record = heap.records[handle];
    if (record.kind === 'string') continue;
    for (let slot = 0; slot < record.data.length; slot++) {
      if (state.edges++ >= maxEdges) {
        state.truncated = true;
        break;
      }
      add(record.data[slot], handle, `${record.kind === 'array' ? 'Element' : 'Field'} ${slot}`);
    }
    if (state.edges >= maxEdges) break;
  }
}
