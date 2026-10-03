import { CilError } from '../binary.js';
import { tableDefinitions, TableId } from './tables.js';
import { codedIndex } from './indices.js';

function valueForColumn(builder, kind, value, column) {
  if (kind === 'str' && typeof value === 'string') return builder.string(value);
  if (kind === 'blob' && value instanceof Uint8Array) return builder.blob(value);
  if (kind === 'guid' && value instanceof Uint8Array) return builder.guid(value);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new CilError(`Invalid metadata value for ${column}`);
  }
  if (kind === 'u16' && value > 0xffff) throw new CilError(`Metadata value overflows ${column}`);
  if (/^t\d+$/.test(kind)) {
    if (value > 0xffffff) {
      if (value >>> 24 !== Number(kind.slice(1))) throw new CilError(`Wrong token kind for ${column}`);
      return value & 0xffffff;
    }
    return value;
  }
  if (!['u16', 'u32', 'str', 'blob', 'guid'].includes(kind)) return codedIndex(kind, value);
  return value;
}

/** Write any named table row. Coded columns accept tokens; heaps accept handles or values. */
export function writeMetadataRow(builder, table, values) {
  const id = typeof table === 'string' ? TableId[table] : table;
  const definition = tableDefinitions[id];
  if (!definition || !values || Array.isArray(values)) throw new CilError('Invalid named metadata row');
  for (const column of Object.keys(values)) {
    if (!definition.columns.includes(column)) throw new CilError(`Unknown ${definition.name} column ${column}`);
  }
  const row = definition.columns.map((column, index) => {
    if (!Object.hasOwn(values, column)) throw new CilError(`Missing ${definition.name} column ${column}`);
    return valueForColumn(builder, definition.types[index], values[column], `${definition.name}.${column}`);
  });
  return builder.add(id, row);
}

/** Build scoped writers from table names or per-builder factories, without prototype or global mutation. */
export function rowWriterGroup(builder, registry) {
  return Object.freeze(Object.fromEntries(Object.entries(registry).map(([method, table]) =>
    [method, typeof table === 'function' ? table(builder) : values => writeMetadataRow(builder, table, values)])));
}
