import { encodeConstant } from './constants.js';
import { constantError } from './constant-errors.js';
import { codedIndex } from './indices.js';
import { writeMetadataRow } from './row-writer.js';

const parentFlags = new Map([[4, 0x8000], [8, 0x1000], [23, 0x1000]]);
const parentTables = Object.freeze([4, 8, 23]);

function parentRow(builder, parent) {
  if (!Number.isInteger(parent) || parent < 0 || parent > 0xffffffff || !(parent & 0xffffff)) throw constantError('MD0125');
  const table = parent >>> 24;
  const row = builder.rows[table]?.[(parent & 0xffffff) - 1];
  if (!parentFlags.has(table) || !Array.isArray(row) || !Number.isInteger(row[0]) || row[0] < 0 || row[0] > 0xffff) {
    throw constantError('MD0125');
  }
  return { row, flag: parentFlags.get(table), coded: codedIndex('HasConstant', parent) };
}

function indexRows(builder, state, maximum, signal) {
  const rows = builder.rows[11];
  if (rows === undefined) {
    if (state.rows) throw constantError('MD0127');
    return;
  }
  if (!Array.isArray(rows)) throw constantError('MD0127');
  if (rows.length >= maximum) throw constantError('MD0123', 'Constant row count limit exceeded');
  if (state.rows && (state.rows !== rows || rows.length < state.count)) throw constantError('MD0127');
  state.rows = rows;
  while (state.count < rows.length) {
    if (signal?.aborted) throw constantError('MD0124');
    const row = rows[state.count];
    const parent = row?.[1];
    if (!Array.isArray(row) || row.length !== 3 || !Number.isInteger(parent) || parent < 4 ||
        parent > 0x3fffffe || (parent & 3) === 3) throw constantError('MD0127');
    const table = parentTables[parent & 3];
    if (!builder.rows[table]?.[(parent >>> 2) - 1]) throw constantError('MD0127');
    if (state.parents.has(parent)) throw constantError('MD0126');
    state.parents.add(parent);
    state.count++;
  }
}

/** Per-builder append-only Constant index. Raw row appends are indexed once before the next typed write. */
export function constantValueWriter(builder) {
  let state;
  return function constantValue(values, options = {}) {
    if (!options || typeof options !== 'object') throw constantError('MD0121');
    if (options.signal?.aborted) throw constantError('MD0124');
    const maximum = options.maxConstants ?? 100000;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000000) throw constantError('MD0123');
    if (!values || typeof values !== 'object' || Array.isArray(values) ||
        Object.keys(values).some(key => !['Parent', 'Type', 'Value'].includes(key)) ||
        !['Parent', 'Type', 'Value'].every(key => Object.hasOwn(values, key))) throw constantError('MD0121');
    const parent = parentRow(builder, values.Parent);
    state ??= { parents: new Set(), rows: undefined, count: 0 };
    indexRows(builder, state, maximum, options.signal);
    if (state.parents.has(parent.coded)) throw constantError('MD0126');
    const encoded = encodeConstant(values.Type, values.Value, options);
    const token = writeMetadataRow(builder, 'Constant', { Type: encoded.type, Parent: values.Parent, Value: encoded.bytes });
    parent.row[0] |= parent.flag;
    state.parents.add(parent.coded);
    state.rows = builder.rows[11];
    state.count = state.rows.length;
    return token;
  };
}
