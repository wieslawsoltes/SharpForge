import { CilError } from '../binary.js';
import { tableDefinitions } from './tables.js';
import { metadataCodedIndices } from './indices.js';
import { metadataLists } from './pointer-tables.js';
import { metadataSortKeys } from './sorting.js';
import { requiredColumns, uniqueKeys, flagColumns, rowRules } from './validation-rules.js';

/** Stable structural diagnostic ids; semantic type resolution belongs to the CIL verifier. */
export const metadataDiagnosticCatalog = Object.freeze({
  MD0001: 'A complete module must contain exactly one Module row',
  MD0002: 'The first TypeDef must be the global <Module> type',
  MD0003: 'An image may contain at most one Assembly row',
  MD0004: 'Invalid table row shape or scalar value',
  MD0005: 'A required column is null',
  MD0006: 'A table index is outside the target table',
  MD0007: 'A coded index has an invalid tag',
  MD0008: 'A string heap index is invalid',
  MD0009: 'A blob heap index is invalid',
  MD0010: 'A GUID heap index is invalid',
  MD0011: 'A list start is outside the target table',
  MD0012: 'List starts must be nondecreasing',
  MD0013: 'A table contains a duplicate unique key',
  MD0014: 'A flags column contains undefined bits',
  MD0015: 'A row violates an ECMA-335 flag or value constraint',
  MD0016: 'A table marked sorted is out of order',
  MD0017: 'Pointer tables require an uncompressed metadata stream',
  MD0018: 'A pointer table must be a permutation of its target table',
  MD0019: 'The global <Module> TypeDef has invalid flags, namespace or base type',
  MD0020: 'A nested type must have nested visibility and a NestedClass row',
  MD0099: 'Metadata diagnostic limit exceeded',
});

function report(context, code, location = {}, detail) {
  if (context.diagnostics.length >= context.maxDiagnostics) {
    if (context.diagnostics.at(-1)?.code !== 'MD0099') {
      context.diagnostics.push({ code: 'MD0099', severity: 'error', message: metadataDiagnosticCatalog.MD0099 });
    }
    return;
  }
  context.diagnostics.push({ code, severity: 'error', message: detail ?? metadataDiagnosticCatalog[code], ...location });
}

function checkColumn(context, value, options) {
  const { metadata } = context;
  const { table, row, column, kind, list } = options;
  const location = { table, row, column };
  if (!Number.isInteger(value) || value < 0 || value > (kind === 'u16' ? 0xffff : 0xffffffff)) {
    report(context, 'MD0004', location);
    return false;
  }
  if (list) return true;
  if (value === 0) {
    if (requiredColumns[table]?.includes(column)) report(context, 'MD0005', location);
    return true;
  }
  const heap = { str: ['string', 'MD0008'], blob: ['blob', 'MD0009'], guid: ['guid', 'MD0010'] }[kind];
  if (heap) {
    try { metadata[heap[0]](value); } catch { report(context, heap[1], location); }
    return true;
  }
  if (/^t\d+$/.test(kind)) {
    if (value > (context.counts[Number(kind.slice(1))] ?? 0)) report(context, 'MD0006', location);
  } else if (metadataCodedIndices[kind]) {
    const [bits, tables] = metadataCodedIndices[kind];
    const target = tables[value & ((1 << bits) - 1)];
    if (target === undefined || target === null) report(context, 'MD0007', location);
    else if (!(value >>> bits) || (value >>> bits) > (context.counts[target] ?? 0)) report(context, 'MD0006', location);
  }
  return true;
}

function checkList(context, table, index, column, list) {
  const { metadata } = context;
  const pointer = metadata.uncompressed && list.pointer && Object.hasOwn(metadata.counts, list.pointer);
  const target = pointer ? list.pointer : list.table;
  const rows = metadata.rows[table];
  const value = rows[index][column];
  const location = { table, row: index + 1, column };
  if (value < 1 || value > (metadata.counts[target] ?? 0) + 1) report(context, 'MD0011', location);
  else if (index > 0 && rows[index - 1][column] >= 1 && rows[index - 1][column] <= (metadata.counts[target] ?? 0) + 1
    && value < rows[index - 1][column]) report(context, 'MD0012', location);
}

function compareRows(left, right, keys) {
  for (const key of keys) {
    const column = key < 0 ? -key - 1 : key;
    const difference = left[column] - right[column];
    if (difference) return key < 0 ? -difference : difference;
  }
  return 0;
}

function checkTable(context, table, rows) {
  const definition = tableDefinitions[table];
  if (!definition) { report(context, 'MD0004', { table }); return; }
  const unique = uniqueKeys[table], seen = new Set();
  const sortKeys = metadataSortKeys[table];
  const sorted = sortKeys && ((context.metadata.sortedMask ?? 0n) & (1n << BigInt(table)));
  for (let index = 0; index < rows.length; index++) {
    if ((index & 255) === 0) checkCancellation(context.signal);
    if (context.diagnostics.length > context.maxDiagnostics) return;
    const row = rows[index], location = { table, row: index + 1 };
    if (!Array.isArray(row) || row.length !== definition.types.length) { report(context, 'MD0004', location); continue; }
    const valid = definition.types.map((kind, column) => {
      const list = metadataLists[`${table}:${column}`];
      const scalarValid = checkColumn(context, row[column], { ...location, column, kind, list });
      if (scalarValid && list) checkList(context, table, index, column, list);
      return scalarValid;
    });
    if (!valid.every(Boolean)) continue;
    if (unique) {
      const key = unique.map(column => row[column]).join(':');
      if (seen.has(key)) report(context, 'MD0013', location);
      seen.add(key);
    }
    const flags = flagColumns[table];
    if (flags && (row[flags[0]] & ~flags[1])) report(context, 'MD0014', { ...location, column: flags[0] });
    const violation = rowRules[table]?.(row);
    if (violation) report(context, 'MD0015', location, violation);
    if (sorted && index && compareRows(rows[index - 1], row, sortKeys) > 0) report(context, 'MD0016', location);
  }
}

function checkModule(context) {
  const { metadata } = context;
  const portablePdb = !metadata.counts[0] && Object.keys(metadata.counts).some(table => Number(table) >= 48);
  if (portablePdb) return;
  if (metadata.counts[0] !== 1) report(context, 'MD0001', { table: 0 });
  if ((metadata.counts[32] ?? 0) > 1) report(context, 'MD0003', { table: 32 });
  const first = metadata.rows[2]?.[0];
  if (!first) { report(context, 'MD0002', { table: 2, row: 1 }); return; }
  let name;
  try { name = metadata.string(first[1]); } catch { return; }
  if (name !== '<Module>') report(context, 'MD0002', { table: 2, row: 1 });
  else if (first[0] !== 0 || first[2] !== 0 || first[3] !== 0) report(context, 'MD0019', { table: 2, row: 1 });
}

function checkPointers(context) {
  const { metadata } = context;
  for (const [pointer, target] of [[3, 4], [5, 6], [7, 8], [19, 20], [22, 23]]) {
    if (!Object.hasOwn(metadata.counts, pointer)) continue;
    if (!metadata.uncompressed) report(context, 'MD0017', { table: pointer });
    if (metadata.counts[pointer] !== (metadata.counts[target] ?? 0)) report(context, 'MD0018', { table: pointer });
  }
}

function checkNesting(context) {
  const { metadata } = context;
  const nested = new Set((metadata.rows[41] ?? []).map(row => row[0]));
  for (let index = 0; index < (metadata.rows[2]?.length ?? 0); index++) {
    const visibility = metadata.rows[2][index][0] & 7;
    if ((visibility >= 2) !== nested.has(index + 1)) report(context, 'MD0020', { table: 2, row: index + 1 });
  }
}

function checkCancellation(signal) {
  if (signal?.aborted) {
    const error = new CilError('Metadata validation canceled');
    error.code = 'MD_CANCELED';
    throw error;
  }
}

/** Return bounded II.22 structural diagnostics; does not execute or resolve referenced code. */
export function validateMetadata(metadata, { maxDiagnostics = 100, signal } = {}) {
  if (!Number.isInteger(maxDiagnostics) || maxDiagnostics < 1 || maxDiagnostics > 10000) {
    throw new CilError('Metadata diagnostic limit must be an integer from 1 through 10000');
  }
  checkCancellation(signal);
  const context = { metadata, maxDiagnostics, signal, diagnostics: [], counts: { ...metadata.externalCounts, ...metadata.counts } };
  checkModule(context);
  for (const [table, rows] of Object.entries(metadata.rows)) checkTable(context, Number(table), rows);
  checkPointers(context);
  checkNesting(context);
  return context.diagnostics;
}
