import { hierarchyIndex, checkedToken } from './tokens.js';
import { rejectTypeSystem } from './results.js';

function nameKeys(metadata, budget) {
  const heap = metadata.streams.get('#Strings');
  const cache = new Map();
  let copiedBytes = 0;
  return index => {
    if (cache.has(index)) return cache.get(index);
    if (!Number.isInteger(index) || index < 0 || !heap || index >= heap.length)
      rejectTypeSystem('CILVT0001', 'type name heap index');
    let end = index;
    while (end < heap.length && heap[end]) {
      if (end - index >= 1024) rejectTypeSystem('CILVT0002', 'type name bytes');
      end++;
    }
    if (end === heap.length) rejectTypeSystem('CILVT0001', 'unterminated type name');
    copiedBytes += end - index;
    if (copiedBytes > budget.maxTypeNameBytes) rejectTypeSystem('CILVT0002', 'type name bytes');
    // Exact UTF-8 byte keys avoid display-decoder BOM or Unicode normalization changing identity.
    // The 1 KiB bound precedes argument expansion; no borrowed heap view escapes construction.
    const key = String.fromCharCode(...heap.subarray(index, end));
    cache.set(index, key);
    return key;
  };
}

function definitionNames(metadata, records, key, budget) {
  const namespaces = new Map();
  for (const record of records.values()) {
    budget.check();
    const rowIndex = (record.type.token & 0xffffff) - 1;
    const row = metadata.rows[2][rowIndex];
    if (!Number.isInteger(row[0]) || row[0] < 0 || row[0] > 0xffffffff)
      rejectTypeSystem('CILVT0001', 'type visibility flags');
    // The global module type and nested definitions cannot be explicit Module-scoped aliases.
    if (!rowIndex || (row[0] & 7) > 1) continue;
    const name = key(row[1]);
    if (!name) rejectTypeSystem('CILVT0001', 'empty type name');
    const namespace = key(row[2]);
    let names = namespaces.get(namespace);
    if (!names) namespaces.set(namespace, names = new Map());
    names.set(name, names.has(name) ? null : record.type.token);
  }
  return namespaces;
}

/** Own numeric aliases to existing definitions; all other scopes remain unresolved. */
export function localTypeReferences(metadata, records, budget) {
  const rows = metadata.rows[1] ?? [];
  if (rows.length > budget.maxTypeReferences) rejectTypeSystem('CILVT0002', 'TypeRef rows');
  const counts = Object.fromEntries([0, 1, 26, 35].map(table => [table, metadata.rows[table]?.length ?? 0]));
  let aliases = null;
  let names = null;
  let key = null;
  for (let index = 0; index < rows.length; index++) {
    budget.check();
    const row = rows[index];
    const scope = hierarchyIndex('ResolutionScope', row[0]);
    if (scope) checkedToken(scope, counts, [0, 1, 26, 35]);
    // Nil scope denotes ExportedType resolution, not a same-module name lookup (ECMA II.22.38).
    if (!scope || scope >>> 24 !== 0) continue;
    if (scope !== 1 || metadata.rows[0]?.length !== 1) rejectTypeSystem('CILVT0001', 'local Module scope');
    if (!aliases) {
      aliases = new Map();
      key = nameKeys(metadata, budget);
      names = definitionNames(metadata, records, key, budget);
    }
    const name = key(row[1]);
    if (!name) rejectTypeSystem('CILVT0001', 'empty TypeRef name');
    const target = names.get(key(row[2]))?.get(name);
    if (target) aliases.set(0x01000001 + index, target);
  }
  return aliases;
}
