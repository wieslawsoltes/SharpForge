import { CilError } from '../binary.js';
import { tableDefinitions } from './tables.js';
import { token } from './indices.js';

export const metadataLists = Object.freeze({
  '2:4': { table: 4, pointer: 3 },
  '2:5': { table: 6, pointer: 5 },
  '6:5': { table: 8, pointer: 7 },
  '18:1': { table: 20, pointer: 19 },
  '21:1': { table: 23, pointer: 22 },
  '50:2': { table: 51 },
  '50:3': { table: 52 },
});

/** Physical list index width follows the pointer table when present in a #- stream. */
export function metadataColumnKind(table, column, counts, uncompressed) {
  const list = metadataLists[`${table}:${column}`];
  if (uncompressed && list?.pointer && Object.hasOwn(counts, list.pointer)) return `t${list.pointer}`;
  return tableDefinitions[table].types[column];
}

/** Return the physical tokens owned by a list, resolving #- pointer indirection. */
export function metadataList(metadata, owner, columnName) {
  const table = owner >>> 24;
  const rowNumber = owner & 0xffffff;
  const definition = tableDefinitions[table];
  const column = definition?.columns.indexOf(columnName);
  const list = metadataLists[`${table}:${column}`];
  if (!list) throw new CilError(`Not a metadata list column: ${columnName}`);
  const row = metadata.row(owner);
  const target = metadata.uncompressed && list.pointer && Object.hasOwn(metadata.counts, list.pointer) ? list.pointer : list.table;
  const end = metadata.rows[table]?.[rowNumber]?.[column] ?? (metadata.counts[target] ?? 0) + 1;
  const start = row[column];
  if (start < 1 || end < start || end > (metadata.counts[target] ?? 0) + 1) throw new CilError('Invalid metadata list range');
  const result = [];
  for (let index = start; index < end; index++) {
    const resolved = target === list.table ? index : metadata.row(token(target, index))[0];
    if (resolved < 1 || resolved > (metadata.counts[list.table] ?? 0)) throw new CilError('Invalid metadata pointer row');
    result.push(token(list.table, resolved));
  }
  return result;
}
