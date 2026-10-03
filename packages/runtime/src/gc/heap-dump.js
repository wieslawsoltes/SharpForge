import {isReference} from './reference.js';
import {diagnosticBudget} from './retention.js';

export const heapDumpSchemaVersion = 1;
export const heapDumpFormat = 'sharpforge-heap-graph';

const identity = reference => `${reference.h}:${reference.g}`;

/** Versioned, portable graph JSON. Bytes are managed estimates, never process memory. */
export function exportHeapDump(heap, options = {}) {
  const {maxObjects, maxEdges} = diagnosticBudget({maxObjects: 1_000_000, maxEdges: 10_000_000, ...options});
  const nodes = [];
  const types = [];
  const typeIds = new Map();
  const included = new Set();
  let truncated = false;
  for (let handle = 0; handle < heap.records.length; handle++) {
    const record = heap.records[handle];
    if (!record) continue;
    if (nodes.length === maxObjects) {
      truncated = true;
      break;
    }
    const key = JSON.stringify([record.kind, record.type]);
    let typeId = typeIds.get(key);
    if (typeId === undefined) {
      typeId = types.length;
      types.push({id: typeId, name: record.type, kind: record.kind});
      typeIds.set(key, typeId);
    }
    const id = `${handle}:${heap.generations[handle]}`;
    included.add(id);
    const description = heap.diagnostics.inspectRecord(handle, record);
    nodes.push({id, typeId, handle, generation: heap.generations[handle], size: record.size,
      length: record.data.length, preview: description.preview, gcGeneration: record.gcGeneration ?? 0,
      space: record.space ?? 'small', allocationSite: record.allocationSite ?? null});
  }
  const edges = [];
  const roots = [];
  const exhausted = Object.freeze({});
  let scanned = 0;
  const count = () => {
    if (++scanned > maxEdges) {
      truncated = true;
      throw exhausted;
    }
  };
  try {
    for (const node of nodes) {
      const record = heap.records[node.handle];
      heap.visitEdges(record, (value, slot) => {
        count();
        if (isReference(value) && included.has(identity(value))) edges.push({from: node.id, to: identity(value), slot, kind: 'strong'});
      });
    }
    heap.lifetime?.visitDiagnosticEdges?.((key, value, label, owner = null) => {
      count();
      if (included.has(identity(key)) && included.has(identity(value)) && (!owner || included.has(identity(owner)))) {
        edges.push({from: identity(key), to: identity(value), kind: 'dependent', label: String(label),
          ...(owner ? {requiresOwner: identity(owner)} : {})});
      }
    });
    heap.visitRoots((value, category, detail) => {
      count();
      if (isReference(value) && included.has(identity(value))) {
        roots.push({to: identity(value), category: String(category ?? 'root'),
          label: typeof detail === 'object' ? String(detail?.name ?? detail?.id ?? '') : String(detail ?? '')});
      }
    }, options.extraRoots ?? []);
  } catch (error) {
    if (error !== exhausted) throw error;
  }
  const sites = [...(heap.allocationSites?.sites ?? [])].map(([id, location]) => ({id, location}));
  return {format: heapDumpFormat, schemaVersion: heapDumpSchemaVersion, stamp: heap.stamp(),
    memoryKind: 'managed-estimate', nodes, edges, roots, types, sites, truncated,
    totals: {objects: nodes.length, bytes: nodes.reduce((total, node) => total + node.size, 0),
      heapLiveObjects: heap.stats.liveObjects, heapLiveBytes: heap.stats.liveBytes, edgesScanned: Math.min(scanned, maxEdges)}};
}

/** Validate untrusted dump data before indexing or rendering; limits count graph entries. */
export function validateHeapDump(dump, options = {}) {
  const {maxObjects, maxEdges} = diagnosticBudget({maxObjects: 1_000_000, maxEdges: 10_000_000, ...options});
  if (dump?.format !== heapDumpFormat || dump.schemaVersion !== heapDumpSchemaVersion) throw new TypeError('Unsupported heap dump format');
  for (const name of ['nodes', 'edges', 'roots', 'types', 'sites']) {
    if (!Array.isArray(dump[name])) throw new TypeError(`Heap dump is missing ${name}`);
  }
  if (dump.nodes.length > maxObjects || dump.types.length > maxObjects || dump.sites.length > 100_000) {
    throw new RangeError('Heap dump object budget exceeded');
  }
  if (dump.edges.length + dump.roots.length > maxEdges) throw new RangeError('Heap dump edge budget exceeded');
  const types = new Set();
  for (const type of dump.types) {
    if (!Number.isSafeInteger(type.id) || type.id < 0 || types.has(type.id) || typeof type.name !== 'string' || typeof type.kind !== 'string') {
      throw new TypeError('Invalid heap dump type');
    }
    if (type.name.length > 8192 || type.kind.length > 256) throw new RangeError('Heap type text budget exceeded');
    types.add(type.id);
  }
  const ids = new Set();
  const handles = new Set();
  const sites = new Set();
  for (const site of dump.sites) {
    if (typeof site.id !== 'string' || site.id.length > 20_000 || sites.has(site.id)
      || !site.location || typeof site.location !== 'object') throw new TypeError('Invalid heap dump site');
    sites.add(site.id);
    for (const field of ['uri', 'methodName']) {
      const value = site.location[field];
      if (value !== null && value !== undefined && (typeof value !== 'string' || value.length > 8192)) {
        throw new TypeError('Invalid heap dump site text');
      }
    }
    for (const field of ['methodToken', 'ilOffset', 'line', 'column']) {
      const value = site.location[field];
      if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new TypeError('Invalid heap dump source location');
      }
    }
  }
  for (const node of dump.nodes) {
    if (!Number.isSafeInteger(node.handle) || node.handle < 0 || !Number.isSafeInteger(node.generation) || node.generation < 0) {
      throw new TypeError('Invalid heap dump identity');
    }
    if (node.id !== `${node.handle}:${node.generation}` || ids.has(node.id) || handles.has(node.handle) || !types.has(node.typeId)) {
      throw new TypeError('Duplicate or unknown heap dump identity');
    }
    if (!Number.isSafeInteger(node.size) || node.size < 0 || !Number.isSafeInteger(node.length) || node.length < 0) {
      throw new TypeError('Invalid heap dump size');
    }
    if (typeof node.preview !== 'string' || node.preview.length > 8192) throw new TypeError('Invalid heap dump preview');
    if (node.allocationSite !== null && (typeof node.allocationSite !== 'string' || node.allocationSite.length > 20_000)) {
      throw new TypeError('Invalid heap dump allocation site');
    }
    ids.add(node.id);
    handles.add(node.handle);
  }
  for (const edge of dump.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new TypeError('Heap dump edge references an absent node');
    if (edge.requiresOwner !== undefined && !ids.has(edge.requiresOwner)) throw new TypeError('Heap dump edge requires an absent owner');
  }
  for (const root of dump.roots) {
    if (!ids.has(root.to) || typeof root.category !== 'string' || typeof root.label !== 'string') throw new TypeError('Invalid heap dump root');
  }
  return dump;
}

/** Read-only adapter for the Studio heap census/page contract; no managed heap is created. */
export class HeapDumpView {
  constructor(dump, options = {}) {
    validateHeapDump(dump, options);
    this.types = new Map(dump.types.map(type => [type.id, {...type}]));
    this.nodes = dump.nodes.map(node => Object.freeze({...node})).sort((left, right) => left.handle - right.handle);
    this.sites = new Map(dump.sites.map(site => [site.id, site.location]));
    this.truncated = Boolean(dump.truncated);
    this.version = `dump:${dump.stamp ?? ''}`;
  }

  inspectRecord(node) {
    const type = this.types.get(node.typeId);
    return {...node, type: type.name, kind: type.kind};
  }

  inspectPage({afterHandle = -1, limit = 200, kind = null, type = null, stamp = null} = {}) {
    if (!Number.isInteger(afterHandle) || afterHandle < -1 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('Invalid heap page request');
    }
    if (stamp !== null && stamp !== this.version) throw new Error('Heap dump changed; restart inspection');
    let low = 0;
    let high = this.nodes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.nodes[middle].handle <= afterHandle) low = middle + 1;
      else high = middle;
    }
    const items = [];
    let more = false;
    for (let index = low; index < this.nodes.length; index++) {
      const item = this.inspectRecord(this.nodes[index]);
      if (kind && item.kind !== kind || type && item.type !== type) continue;
      if (items.length === limit) {
        more = true;
        break;
      }
      items.push(item);
    }
    return {items, stamp: this.version, next: more ? items.at(-1).handle : null, totalLiveObjects: this.nodes.length, truncated: this.truncated};
  }

  inspect(limit = 200) {
    if (!Number.isInteger(limit) || limit < 0 || limit > 10_000) throw new RangeError('Invalid heap inspection limit');
    return this.nodes.slice(0, limit).map(node => this.inspectRecord(node));
  }

  census() {
    const grouped = new Map();
    const sites = new Map();
    let bytes = 0;
    for (const node of this.nodes) {
      const type = this.types.get(node.typeId);
      let item = grouped.get(node.typeId);
      if (!item) grouped.set(node.typeId, item = {kind: type.kind, type: type.name, objects: 0, bytes: 0});
      item.objects++;
      item.bytes += node.size;
      bytes += node.size;
      let site = sites.get(node.allocationSite);
      if (!site) {
        site = {site: node.allocationSite, location: this.sites.get(node.allocationSite) ?? null, objects: 0, bytes: 0};
        sites.set(node.allocationSite, site);
      }
      site.objects++;
      site.bytes += node.size;
    }
    return {stamp: this.version, objects: this.nodes.length, bytes, estimatedBytes: true, truncated: this.truncated,
      types: [...grouped.values()].sort((left, right) => right.bytes - left.bytes || left.type.localeCompare(right.type)),
      sites: [...sites.values()].sort((left, right) => right.bytes - left.bytes)};
  }
}
