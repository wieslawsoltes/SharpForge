import { CilError } from './binary.js';
import { tableDefinitions } from './metadata/tables.js';
import { TableViewBudget, checkTableCancellation, tableInteger, tableOptions, tablePage } from './inspector-tables/budget.js';
import { tableViewInput, tableDefinition, tableColumns, physicalRow } from './inspector-tables/input.js';
import { tableHeapNames, tableHeap, tableHeapEntry } from './inspector-tables/heaps.js';
import { tableRow } from './inspector-tables/rows.js';

/** Opt-in physical metadata inspection over the existing PE/CLI reader; never loads or executes an assembly. */
export class MetadataTableInspector {
  #context;

  constructor(source, options = {}) {
    this.#context = tableViewInput(source, tableOptions(options));
  }

  #current() {
    if (!this.#context) throw new CilError('Metadata table inspector is disposed');
    return this.#context;
  }

  tables(options = {}) {
    const { includeEmpty = true, signal } = tableOptions(options);
    if (typeof includeEmpty !== 'boolean') throw new CilError('Invalid metadata includeEmpty option');
    const context = this.#current(), result = [];
    for (const definition of Object.values(tableDefinitions)) {
      checkTableCancellation(signal);
      const rowCount = context.metadata.counts[definition.id] ?? 0;
      if (!includeEmpty && !rowCount) continue;
      const columns = tableColumns(context, definition);
      const location = rowCount ? physicalRow(context, definition.id, 1)
        : { streamOffset: null, fileOffset: null, metadataOffset: null };
      result.push({ table: definition.id, name: definition.name, rowCount,
        rowSize: columns.reduce((sum, column) => sum + column.width, 0),
        present: Object.hasOwn(context.metadata.counts, definition.id),
        externalRowCount: context.metadata.externalCounts[definition.id] ?? 0,
        sorted: !!(context.metadata.sortedMask & 1n << BigInt(definition.id)), ...location, columns });
    }
    return result;
  }

  rows(table, options = {}) {
    const context = this.#current(), definition = tableDefinition(table), budget = new TableViewBudget(options);
    const { resolveTokens = true } = options;
    if (typeof resolveTokens !== 'boolean') throw new CilError('Invalid metadata resolveTokens option');
    const { end, ...page } = tablePage(options, context.metadata.counts[definition.id] ?? 0);
    const rows = [];
    const rowOptions = { budget, resolveTokens, schema: tableColumns(context, definition) };
    for (let index = page.offset; index < end; index++)
      rows.push(tableRow(context, definition, index + 1, rowOptions));
    return { table: definition.id, name: definition.name, ...page, rows };
  }

  row(metadataToken, options = {}) {
    tableOptions(options);
    tableInteger(metadataToken, 'row token', 0xffffffff, 1);
    if (!(metadataToken & 0xffffff)) throw new CilError('Metadata row token has a nil row');
    const result = this.rows(metadataToken >>> 24, { ...options, offset: (metadataToken & 0xffffff) - 1, limit: 1 }).rows[0];
    if (!result) throw new CilError('Metadata row token is outside its table');
    return result;
  }

  streams(options = {}) {
    const { signal } = tableOptions(options);
    const result = [];
    for (const { name, data, fileOffset, metadataOffset } of this.#current().streams.values()) {
      checkTableCancellation(signal);
      result.push({ name, byteLength: data.length, fileOffset, metadataOffset });
    }
    return result;
  }

  heaps(options = {}) {
    return this.streams(options).filter(stream => tableHeapNames.includes(stream.name));
  }

  heapEntry(name, index, options = {}) {
    return tableHeapEntry(this.#current(), name, index, new TableViewBudget(options));
  }

  /** Heap paging uses byte offsets; nextOffset can be supplied unchanged. GUID handles remain one-based. */
  heap(name, options = {}) {
    const context = this.#current(), heap = tableHeap(context, name), budget = new TableViewBudget(options);
    const totalBytes = heap?.data.length ?? 0;
    const { offset: pageOffset = 0, limit: pageLimit = 100 } = options;
    const offset = tableInteger(pageOffset, 'heap page offset', totalBytes);
    const limit = tableInteger(pageLimit, 'heap page limit', 1000);
    if (name === '#GUID' && offset % 16) throw new CilError('GUID heap byte offset is not aligned');
    const entries = [];
    let next = offset;
    while (entries.length < limit && next < totalBytes) {
      const entry = tableHeapEntry(context, name, name === '#GUID' ? next / 16 + 1 : next, budget, true);
      entries.push(entry);
      next += entry.byteLength;
    }
    return { name, offset, limit, totalBytes, nextOffset: limit && next < totalBytes ? next : null, entries };
  }

  dispose() {
    this.#context = null;
  }
}
