import {allocationSiteHistogram} from './allocation-sites.js';
import {retentionPath, retentionPaths} from './retention.js';
import {computeDominators} from './dominators.js';
import {exportHeapDump, HeapDumpView} from './heap-dump.js';
import {diffHeapDumps} from './snapshot-diff.js';

function validatePage(options) {
  const {afterHandle = -1, limit = 200, kind = null, type = null} = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isInteger(afterHandle) || afterHandle < -1) {
    throw new RangeError('Invalid heap page request');
  }
  if (kind !== null && typeof kind !== 'string' || type !== null && typeof type !== 'string') {
    throw new TypeError('Heap page filters must be strings');
  }
  return {afterHandle, limit, kind, type};
}

function staleCursor(reason) {
  const error = new Error(`Heap changed; restart inspection: ${reason}`);
  error.code = 'GC_INSPECTION_CURSOR_STALE';
  return error;
}

/** Heap diagnostics never root managed objects. Cursors carry identities, not host handles. */
export class HeapDiagnostics {
  constructor(heap) {
    this.heap = heap;
    this.cursorEpoch = 0;
  }

  stamp() {
    const heap = this.heap;
    return `${heap.mutationRevision}:${heap.generationCounter}:${heap.stats.collections}:${heap.stats.liveObjects}`;
  }

  census() {
    const counts = new Map();
    for (const record of this.heap.records) {
      if (!record) continue;
      const key = JSON.stringify([record.kind, record.type]);
      let item = counts.get(key);
      if (!item) {
        item = {kind: record.kind, type: record.type, objects: 0, bytes: 0};
        counts.set(key, item);
      }
      item.objects++;
      item.bytes += record.size;
    }
    return {stamp: this.stamp(), objects: this.heap.stats.liveObjects, bytes: this.heap.stats.liveBytes,
      types: [...counts.values()].sort((left, right) => right.bytes - left.bytes || left.type.localeCompare(right.type)),
      sites: allocationSiteHistogram(this.heap), estimatedBytes: true,
      sampling: this.heap.allocationSites ? {enabled: this.heap.allocationSites.enabled,
        interval: this.heap.allocationSites.sampleInterval, droppedSites: this.heap.allocationSites.dropped} : {enabled: false}};
  }

  /** Generation-stable keyset paging. Newly allocated objects are outside this enumeration. */
  inspectPage(options = {}) {
    const token = options.cursor ?? options.stamp ?? null;
    const inherited = options.cursor && typeof options.cursor === 'object' ? options.cursor : {};
    const request = validatePage({...inherited, ...options});
    const boundary = this.pageBoundary(token, request);
    const items = [];
    let more = false;
    for (let handle = request.afterHandle + 1; handle < boundary.upperBound; handle++) {
      const record = this.heap.records[handle];
      if (!record || (record.allocationId ?? this.heap.generations[handle]) > boundary.allocationWatermark) continue;
      if (request.kind && record.kind !== request.kind || request.type && record.type !== request.type) continue;
      if (items.length === request.limit) {
        more = true;
        break;
      }
      items.push(this.inspectRecord(handle, record));
    }
    const cursor = {schemaVersion: 1, epoch: this.cursorEpoch, upperBound: boundary.upperBound,
      allocationWatermark: boundary.allocationWatermark, afterHandle: items.at(-1)?.handle ?? request.afterHandle,
      kind: request.kind, type: request.type, page: items.map(item => [item.handle, item.generation])};
    return {items, stamp: cursor, cursor, mutationStamp: this.stamp(), next: more ? cursor.afterHandle : null,
      totalLiveObjects: this.heap.stats.liveObjects};
  }

  pageBoundary(token, request) {
    if (typeof token === 'string') {
      if (token !== this.stamp()) throw staleCursor('explicit mutation stamp expired');
      token = null;
    }
    if (token === null) {
      return {upperBound: this.heap.records.length, allocationWatermark: this.heap.generationCounter};
    }
    if (token?.schemaVersion !== 1 || !Array.isArray(token.page) || token.page.length > 1000) {
      throw new TypeError('Invalid heap inspection cursor');
    }
    for (const name of ['epoch', 'upperBound', 'allocationWatermark']) {
      if (!Number.isSafeInteger(token[name]) || token[name] < 0) throw new TypeError('Invalid heap inspection cursor');
    }
    if (token.upperBound > this.heap.records.length || token.allocationWatermark > this.heap.generationCounter) {
      throw new TypeError('Heap inspection cursor exceeds the current table');
    }
    if (token.epoch !== this.cursorEpoch) throw staleCursor('heap was restored');
    if (token.afterHandle !== request.afterHandle || token.kind !== request.kind || token.type !== request.type) {
      throw new TypeError('Heap cursor and page position or filters do not match');
    }
    for (const entry of token.page) {
      if (!Array.isArray(entry) || entry.length !== 2 || !entry.every(Number.isSafeInteger)) {
        throw new TypeError('Invalid heap page identity');
      }
      const [handle, generation] = entry;
      if (handle < 0 || handle >= token.upperBound || generation < 0) throw new TypeError('Invalid heap page identity');
      if (this.heap.generations[handle] !== generation) throw staleCursor(`slot ${handle} was reused`);
    }
    return token;
  }

  inspectRecord(handle, record) {
    return {handle, generation: this.heap.generations[handle], type: record.type, kind: record.kind,
      size: record.size, length: record.data.length,
      preview: record.kind === 'string' ? record.data.slice(0, 120) : `${record.data.length} ${record.kind === 'array' ? 'elements' : 'fields'}`,
      gcGeneration: record.gcGeneration ?? 0, space: record.space ?? 'small', allocationSite: record.allocationSite ?? null};
  }

  inspect(limit = 200) {
    if (!Number.isInteger(limit) || limit < 0 || limit > 10_000) throw new RangeError('Invalid heap inspection limit');
    const items = [];
    for (let handle = 0; handle < this.heap.records.length && items.length < limit; handle++) {
      const record = this.heap.records[handle];
      if (record) items.push(this.inspectRecord(handle, record));
    }
    return items;
  }

  retentionPath(reference, options) {
    return retentionPath(this.heap, reference, options);
  }

  retentionPaths(reference, options) {
    return retentionPaths(this.heap, reference, options);
  }

  dominators(options) {
    return computeDominators(this.heap, options);
  }

  exportDump(options) {
    return exportHeapDump(this.heap, options);
  }

  importDump(dump) {
    return new HeapDumpView(dump);
  }

  diffDumps(before, after) {
    return diffHeapDumps(before, after);
  }

  snapshot() {
    return {version: 1, cursorEpoch: this.cursorEpoch};
  }

  validateSnapshot(state) {
    if (state?.version !== 1 || !Number.isSafeInteger(state.cursorEpoch) || state.cursorEpoch < 0) {
      throw new TypeError('Invalid heap diagnostics snapshot');
    }
  }

  restore(state) {
    this.validateSnapshot(state);
    this.cursorEpoch = Math.max(this.cursorEpoch, state.cursorEpoch) + 1;
  }
}
