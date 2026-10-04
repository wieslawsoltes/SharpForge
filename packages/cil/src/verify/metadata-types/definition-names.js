import { rejectTypeSystem } from './results.js';
import { snapshotMetadataNesting } from '../metadata-nesting.js';

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

function addName(owners, owner, row, key, token) {
  const name = key(row[1]);
  if (!name) rejectTypeSystem('CILVT0001', 'empty type name');
  const namespace = key(row[2]);
  let namespaces = owners.get(owner);
  if (!namespaces) owners.set(owner, namespaces = new Map());
  let names = namespaces.get(namespace);
  if (!names) namespaces.set(namespace, names = new Map());
  names.set(name, names.has(name) ? null : token);
}

/** Construction-only exact byte names, indexed under canonical enclosing TypeDef tokens. */
export function localDefinitionNames(metadata, records, budget) {
  const key = nameKeys(metadata, budget);
  const owners = new Map();
  let lexical = null;
  for (const record of records.values()) {
    budget.check();
    const rowIndex = (record.type.token & 0xffffff) - 1;
    const row = metadata.rows[2][rowIndex];
    if (!Number.isInteger(row[0]) || row[0] < 0 || row[0] > 0xffffffff)
      rejectTypeSystem('CILVT0001', 'type visibility flags');
    if (rowIndex && (row[0] & 7) <= 1) addName(owners, 0, row, key, record.type.token);
  }
  function lookup(owner, row) {
    const name = key(row[1]);
    if (!name) rejectTypeSystem('CILVT0001', 'empty TypeRef name');
    return owners.get(owner)?.get(key(row[2]))?.get(name) ?? 0;
  }
  function indexNested() {
    const rows = metadata.rows[41] ?? [];
    if (rows.length > records.size) rejectTypeSystem('CILVT0002', 'nested type rows');
    const visibility = new Uint8Array(records.size);
    for (let index = 0; index < visibility.length; index++) {
      budget.check();
      visibility[index] = metadata.rows[2][index][0] & 7;
    }
    const parents = snapshotMetadataNesting(rows, visibility, {
      check: budget.check,
      invalid: detail => rejectTypeSystem('CILVT0001', detail),
      limit: detail => rejectTypeSystem('CILVT0002', detail),
    });
    lexical = { parents, visibility };
    if (!parents) return;
    for (let rid = 1; rid < parents.length; rid++) {
      budget.check();
      if (parents[rid]) addName(owners, 0x02000000 + parents[rid], metadata.rows[2][rid - 1], key, 0x02000000 + rid);
    }
  }
  return {
    top: row => lookup(0, row),
    nested(owner, row) {
      if (!lexical) indexNested();
      return lookup(owner, row);
    },
    get lexical() { return lexical; },
  };
}
