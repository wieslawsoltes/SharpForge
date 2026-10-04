import { CilError } from '../binary.js';
import { decodeCoded, token } from '../metadata/indices.js';
import { metadataLists } from '../metadata/pointer-tables.js';
import { tableDefinitions } from '../metadata/tables.js';
import { physicalRow, tableColumns } from './input.js';
import { tableHeapEntry } from './heaps.js';

const heapKinds = Object.freeze({ str: '#Strings', blob: '#Blob', guid: '#GUID' });

function reference(context, value, budget) {
  if (!value) return { token: 0, status: 'nil', table: null, rowId: 0, name: null, fileOffset: null };
  const table = value >>> 24, rowId = value & 0xffffff, definition = tableDefinitions[table];
  const result = { token: value, table, tableName: definition?.name ?? null, rowId, name: null, fileOffset: null };
  if (!definition || !rowId) return { ...result, status: 'invalid' };
  if (context.metadata.minimalDelta)
    return { ...result, status: 'unresolved', reason: 'delta-context-required' };
  const row = context.metadata.rows[table]?.[rowId - 1];
  if (!row) {
    const external = !Object.hasOwn(context.metadata.counts, table) && rowId > 0 &&
      rowId <= (context.metadata.externalCounts[table] ?? 0);
    return { ...result, status: external ? 'external' : 'invalid' };
  }
  const nameColumn = definition.columns.findIndex(name => name === 'Name' || name === 'TypeName');
  const namespaceColumn = definition.columns.findIndex(name => name === 'Namespace' || name === 'TypeNamespace');
  if (nameColumn >= 0 && definition.types[nameColumn] === 'str')
    result.name = tableHeapEntry(context, '#Strings', row[nameColumn], budget).value;
  if (namespaceColumn >= 0)
    result.namespace = tableHeapEntry(context, '#Strings', row[namespaceColumn], budget).value;
  return { ...result, status: 'resolved', fileOffset: physicalRow(context, table, rowId).fileOffset };
}

function listValue(context, { definition, rowId, column }, raw, { budget, resolveTokens }) {
  const list = metadataLists[`${definition.id}:${column}`];
  const pointer = context.metadata.uncompressed && list.pointer && Object.hasOwn(context.metadata.counts, list.pointer);
  const physicalTable = pointer ? list.pointer : list.table;
  if (context.metadata.minimalDelta)
    return { kind: 'list', table: list.table, physicalTable, start: raw, end: null, count: null,
      status: 'unresolved', reason: 'delta-context-required', first: null };
  const total = context.metadata.counts[physicalTable] ?? 0;
  const end = context.metadata.rows[definition.id]?.[rowId]?.[column] ?? total + 1;
  const valid = Number.isInteger(end) && raw >= 1 && end >= raw && end <= total + 1;
  const firstToken = raw <= total && raw > 0 ? token(physicalTable, raw) : 0;
  return { kind: 'list', table: list.table, physicalTable, start: raw, end, count: valid ? end - raw : null,
    status: !valid ? 'invalid' : end === raw ? 'empty' : 'resolved',
    first: !valid || end === raw || !firstToken ? null : resolveTokens ? reference(context, firstToken, budget) : firstToken };
}

function columnValue(context, owner, raw, options) {
  const { definition, column } = owner;
  const { budget, resolveTokens } = options;
  const kind = definition.types[column], heapName = heapKinds[kind];
  if (heapName) {
    if (context.metadata.minimalDelta && raw !== 0)
      return { value: null, heap: { heap: heapName, index: raw, offset: null, fileOffset: null, metadataOffset: null,
        byteLength: null, payloadFileOffset: null, payloadByteLength: null, isNil: false,
        status: 'unresolved', reason: 'delta-context-required' } };
    const { value, display, ...heap } = tableHeapEntry(context, heapName, raw, budget);
    return { value, heap, ...(display === undefined ? {} : { display }) };
  }
  if (metadataLists[`${definition.id}:${column}`])
    return { value: listValue(context, owner, raw, options) };
  let target;
  if (/^t\d+$/.test(kind)) {
    if (raw > 0xffffff) throw new CilError('Metadata simple index exceeds the 24-bit token range');
    target = raw === 0 ? 0 : token(Number(kind.slice(1)), raw);
  }
  else if (kind !== 'u16' && kind !== 'u32') target = decodeCoded(kind, raw);
  else if ((definition.id === 30 || definition.id === 31) && column === 0) target = raw;
  else return { value: raw };
  return { value: resolveTokens ? reference(context, target, budget) : target };
}

/** Named cell values retain their exact physical scalar and byte extent; no method body is requested. */
export function tableRow(context, definition, rowId, options) {
  const { budget, schema = tableColumns(context, definition) } = options;
  const source = context.metadata.rows[definition.id]?.[rowId - 1];
  if (!Array.isArray(source) || source.length !== schema.length) throw new CilError('Invalid metadata view row');
  const location = physicalRow(context, definition.id, rowId);
  const byteLength = schema.reduce((sum, column) => sum + column.width, 0);
  if (location.streamOffset + byteLength > context.tableStream.data.length)
    throw new CilError('Metadata row extends outside the table stream');
  budget.charge(byteLength);
  const columns = {};
  for (let index = 0; index < schema.length; index++) {
    const column = schema[index], raw = source[index];
    if (!Number.isInteger(raw) || raw < 0 || raw > (column.width === 2 ? 0xffff : 0xffffffff))
      throw new CilError('Invalid metadata view column value');
    columns[column.name] = { kind: column.kind, physicalKind: column.physicalKind, width: column.width,
      fileOffset: location.fileOffset + column.offset, metadataOffset: location.metadataOffset + column.offset,
      raw, ...columnValue(context, { definition, rowId, column: index }, raw, options) };
  }
  return { token: token(definition.id, rowId), table: definition.id, tableName: definition.name,
    rowId, ...location, byteLength, columns };
}
