import { CilError } from '../binary.js';
import { tableDefinitions } from '../metadata/tables.js';
import { token } from '../metadata/indices.js';
import { tableViewInput, tableColumns, physicalRow } from '../inspector-tables/input.js';
import { tableHeapEntry } from '../inspector-tables/heaps.js';
import { InventoryBudget, inventoryCancellation, inventoryFailure, inventoryDiagnostics } from './inventory-contracts.js';

// These summaries expose declared names and encoded scalars, without binding references or reconstructing declarations.
const summaryTables = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  28, 29, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44]);
const counts = () => ({ rendered: 0, summarized: 0, unsupported: 0 });

function census(context, limits) {
  const { metadata } = context;
  if (!metadata.counts || typeof metadata.counts !== 'object' || Array.isArray(metadata.counts) ||
      !metadata.rows || typeof metadata.rows !== 'object' || Array.isArray(metadata.rows)) {
    inventoryFailure('CILDI0004', 'table containers');
  }
  let totalRows = 0;
  let physicalBytes = 0;
  for (const [key, count] of Object.entries(metadata.counts)) {
    inventoryCancellation(limits.signal);
    const table = Number(key);
    if (String(table) !== key || !tableDefinitions[table] || !Number.isSafeInteger(count) || count < 0 || count > 0xffffff) {
      inventoryFailure('CILDI0004', 'table count');
    }
    if (!Array.isArray(metadata.rows[table]) || metadata.rows[table].length !== count) {
      inventoryFailure('CILDI0004', tableDefinitions[table].name);
    }
    totalRows += count;
    physicalBytes += count * tableColumns(context, tableDefinitions[table]).reduce((sum, column) => sum + column.width, 0);
  }
  if (Object.keys(metadata.rows).some((table) => !Object.hasOwn(metadata.counts, table))) {
    inventoryFailure('CILDI0004', 'rows without a physical table count');
  }
  if (totalRows > limits.maxRows) inventoryFailure('CILDI0002', 'physical rows');
  if (physicalBytes > limits.maxBytes) inventoryFailure('CILDI0002', 'physical row bytes');
  return totalRows;
}

function rawRecord(context, definition, columns, rowId, budget) {
  const source = context.metadata.rows[definition.id][rowId - 1];
  if (!Array.isArray(source) || source.length !== columns.length) inventoryFailure('CILDI0004', definition.name);
  const byteLength = columns.reduce((sum, column) => sum + column.width, 0);
  budget.charge(byteLength);
  const location = physicalRow(context, definition.id, rowId);
  if (location.streamOffset + byteLength > context.tableStream.data.length) {
    inventoryFailure('CILDI0004', 'row outside table stream');
  }
  for (const [index, value] of source.entries()) {
    if (!Number.isInteger(value) || value < 0 || value > (columns[index].width === 2 ? 0xffff : 0xffffffff)) {
      inventoryFailure('CILDI0004', 'column scalar width');
    }
  }
  return { token: token(definition.id, rowId), table: definition.id, tableName: definition.name, rowId,
    ...location, byteLength, raw: [...source], status: 'unsupported', reason: 'unsupported-table', diagnostic: null };
}

function declaredString(context, index, budget, names) {
  const previous = names.get(index);
  if (previous?.error) throw previous.error;
  if (previous) {
    budget.charge(previous.byteLength);
    return previous.value;
  }
  budget.beginEntry();
  try {
    const entry = tableHeapEntry(context, '#Strings', index, budget);
    names.set(index, { value: entry.value, byteLength: entry.byteLength });
    return entry.value;
  } catch (error) {
    if (error instanceof CilError && !/^CILDI/.test(error.code ?? '')) names.set(index, { error });
    throw error;
  } finally {
    budget.endEntry();
  }
}

function summarize(context, definition, record, budget, names) {
  if (context.metadata.minimalDelta) {
    record.reason = 'generation-context-required';
    return;
  }
  if (definition.id === 6) {
    record.reason = 'method-result-unavailable';
    return;
  }
  if (!summaryTables.has(definition.id)) return;
  const declaredStrings = {};
  try {
    for (const [column, kind] of definition.types.entries()) {
      if (kind !== 'str') continue;
      declaredStrings[definition.columns[column]] = declaredString(context, record.raw[column], budget, names);
    }
    record.status = 'summarized';
    record.reason = 'physical-metadata-summary';
    record.summary = { kind: 'declared-names-and-encoded-scalars', strings: declaredStrings };
  } catch (error) {
    if (!(error instanceof CilError) || /^CILDI/.test(error.code ?? '')) throw error;
    record.reason = 'invalid-row-summary';
    record.diagnostic = { code: 'CILDI0005', severity: 'error', message: error.message };
  }
}

/** Snapshot every local physical row exactly once; external PDB counts and EnC aggregate identities are never invented. */
export function createMetadataInventory(input, limits) {
  inventoryCancellation(limits.signal);
  let context;
  try {
    context = tableViewInput(input, { signal: limits.signal });
  } catch (error) {
    inventoryCancellation(limits.signal);
    throw error;
  }
  const totalRows = census(context, limits);
  const budget = new InventoryBudget(limits);
  const names = new Map();
  const tables = [];
  for (const definition of Object.values(tableDefinitions)) {
    inventoryCancellation(limits.signal);
    const columns = tableColumns(context, definition);
    const rowCount = context.metadata.counts[definition.id] ?? 0;
    const rows = [];
    for (let rowId = 1; rowId <= rowCount; rowId++) {
      const record = rawRecord(context, definition, columns, rowId, budget);
      summarize(context, definition, record, budget, names);
      rows.push(record);
    }
    tables.push({ table: definition.id, name: definition.name, rowCount,
      present: Object.hasOwn(context.metadata.counts, definition.id),
      externalRowCount: context.metadata.externalCounts[definition.id] ?? 0, columns, rows, ...counts() });
  }
  return { schemaVersion: 1, identity: 'physical-table-row', minimalDelta: context.metadata.minimalDelta,
    totalRows, accountedRows: totalRows, accountingComplete: true, sourceComplete: false,
    summaryBytes: limits.maxBytes - budget.remaining, tables, ...counts(), diagnostics: [] };
}

function methodResults(methods, total, signal) {
  if (!Array.isArray(methods)) inventoryFailure('CILDI0001', 'decompile results');
  const results = new Map();
  for (const [resultIndex, method] of methods.entries()) {
    inventoryCancellation(signal);
    if (!method || !Number.isInteger(method.token) || method.token < 0x06000001 || method.token > 0x06000000 + total ||
        results.has(method.token) || !Array.isArray(method.diagnostics) || typeof method.complete !== 'boolean' ||
        !['cil', 'csharp'].includes(method.language) || typeof method.source !== 'string') {
      inventoryFailure('CILDI0001', 'duplicate, invalid or out-of-range decompile result');
    }
    results.set(method.token, { resultIndex, method });
  }
  return results;
}

function methodCoverage(row, result) {
  if (!result || result.method.diagnostics.some((diagnostic) => diagnostic.code === 'INVALID_METHOD')) return;
  row.status = 'summarized';
  row.reason = 'method-output-is-partial';
  const { method, resultIndex } = result;
  const extent = method.complete ? 'method-body' : method.language === 'cil' ? 'cil-listing' : 'absence-diagnostic';
  row.renderedOutput = { resultIndex, extent, language: method.language };
  row.diagnostic = { code: 'CILDI0008', severity: 'info', message: inventoryDiagnostics.CILDI0008 };
}

/** Link explicit emitted extents and recompute status counts; method completeness never implies whole-row or source completeness. */
export function finishMetadataInventory(inventory, methods, signal) {
  inventoryCancellation(signal);
  const methodTable = inventory.tables.find((table) => table.table === 6);
  const results = methodResults(methods, methodTable.rowCount, signal);
  const totals = counts();
  const diagnostics = [{ code: 'CILDI0006', severity: 'warning', message: inventoryDiagnostics.CILDI0006 }];
  let accountedRows = 0;
  for (const table of inventory.tables) {
    const tableCounts = counts();
    for (const row of table.rows) {
      inventoryCancellation(signal);
      if (table.table === 6 && !inventory.minimalDelta) methodCoverage(row, results.get(row.token));
      tableCounts[row.status]++;
      totals[row.status]++;
      accountedRows++;
    }
    Object.assign(table, tableCounts);
    if (table.unsupported) diagnostics.push({ code: table.table === 6 ? 'CILDI0007' : 'CILDI0009',
      severity: 'warning', table: table.table, tableName: table.name, rows: table.unsupported,
      message: inventoryDiagnostics[table.table === 6 ? 'CILDI0007' : 'CILDI0009'] });
  }
  if (accountedRows !== inventory.totalRows) inventoryFailure('CILDI0004', 'final row accounting');
  Object.assign(inventory, totals, { accountedRows, diagnostics });
  return inventory;
}

/** Preserve the declared assembly/module name without revisiting unsupported heaps or resources. */
export function inventoryAssemblyName(inventory) {
  const assembly = inventory.tables.find((table) => table.table === 32).rows[0];
  const module = inventory.tables.find((table) => table.table === 0).rows[0];
  return (assembly ?? module)?.summary?.strings.Name ?? null;
}
