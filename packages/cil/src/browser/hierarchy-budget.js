import { CilError, Reader } from '../binary.js';
import { decodeCoded } from '../metadata.js';

const maxima = { maxAssemblies: 256, maxTypes: 100000, maxRows: 300000, maxEdges: 200000,
  maxNameBytes: 16 * 1024 * 1024, maxKeyBytes: 1024 * 1024, maxQueryNodes: 10000, maxDepth: 256 };
export const invalidHierarchy = detail => { throw new CilError(`Invalid type hierarchy: ${detail}`); };
export const hierarchyLimit = detail => { throw new CilError(`Type hierarchy limit exceeded: ${detail}`); };

export function hierarchyBudget(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) invalidHierarchy('options');
  const signal = options.signal;
  const budget = { check() {
    if (signal?.aborted) throw new CilError('Type hierarchy cancelled');
  } };
  for (const [key, maximum] of Object.entries(maxima)) {
    const value = options[key] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) invalidHierarchy(key);
    budget[key] = value;
  }
  budget.check();
  return budget;
}

export function hierarchyToken(metadata, value, tables) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff || !(value & 0xffffff)
    || !tables.includes(value >>> 24)) invalidHierarchy('token');
  metadata.row(value);
  return value;
}

export function hierarchyCoded(metadata, kind, value, tables, nullable = false) {
  const result = decodeCoded(kind, value);
  return result === 0 && nullable ? 0 : hierarchyToken(metadata, result, tables);
}

function nameLength(metadata, index) {
  const heap = metadata.streams.get('#Strings');
  if (!Number.isInteger(index) || index < 0 || !heap || index >= heap.length) invalidHierarchy('name heap index');
  let end = index;
  while (end < heap.length && heap[end]) {
    if (end - index >= 1024) hierarchyLimit('individual name bytes');
    end++;
  }
  if (end === heap.length) invalidHierarchy('unterminated name');
  return end - index;
}

export function hierarchyKey(metadata, index) {
  const heap = metadata.streams.get('#Blob');
  if (!Number.isInteger(index) || index < 0 || !heap || index >= heap.length) invalidHierarchy('key heap index');
  const reader = new Reader(heap, index);
  const length = reader.compressed();
  if (length > 16384) hierarchyLimit('individual assembly key bytes');
  return reader.take(length);
}

/** Bound every occurrence before any retained names, graph records or key digests are created. */
export function preflightHierarchy(assemblies, budget) {
  if (!Array.isArray(assemblies) || assemblies.length > budget.maxAssemblies) hierarchyLimit('assemblies');
  let types = 0, rows = 0, edges = 0, names = 0, keys = 0;
  for (const inspector of assemblies) {
    budget.check();
    const metadata = inspector?.metadata;
    if (!metadata?.rows || !metadata.streams) invalidHierarchy('loaded inspector');
    for (const table of [0, 1, 2, 9, 26, 27, 32, 35, 39, 41, 42]) rows += metadata.rows[table]?.length ?? 0;
    types += metadata.rows[2]?.length ?? 0;
    edges += (metadata.rows[2]?.length ?? 0) + (metadata.rows[9]?.length ?? 0);
    if (rows > budget.maxRows || types > budget.maxTypes || edges > budget.maxEdges) hierarchyLimit('metadata rows/edges');
  }
  for (const { metadata } of assemblies) {
    for (const [table, columns] of [[1, [1, 2]], [2, [1, 2]], [32, [7, 8]], [35, [6, 7]]]) {
      for (const row of metadata.rows[table] ?? []) {
        budget.check();
        for (const column of columns) names += nameLength(metadata, row[column]);
        if (names > budget.maxNameBytes) hierarchyLimit('aggregate name bytes');
      }
    }
    for (const [table, column] of [[32, 6], [35, 5]]) {
      for (const row of metadata.rows[table] ?? []) {
        budget.check();
        keys += hierarchyKey(metadata, row[column]).length;
        if (keys > budget.maxKeyBytes) hierarchyLimit('aggregate key bytes');
      }
    }
  }
  return { modules: assemblies.length, types, rows, edges, nameBytes: names, keyBytes: keys };
}
