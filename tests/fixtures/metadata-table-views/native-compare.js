import { MetadataTableInspector } from '@sharpforge/cil';

const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
const equal = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Native metadata view mismatch: ${label}`);
};

/** Shared Node/browser gate: no native process or compiler runs while comparing retained observations. */
export function compareNativeImage(bytes, native) {
  const view = new MetadataTableInspector(bytes);
  const tables = view.tables({ includeEmpty: false });
  equal(tables.map(table => table.table), native.tables.map(table => table.table), 'table inventory');
  let rowCount = 0;
  for (const expected of native.tables) {
    const table = tables.find(table => table.table === expected.table);
    for (const property of ['rowCount', 'rowSize', 'fileOffset']) equal(table[property], expected[property], `${table.name} ${property}`);
    for (const row of expected.rows) {
      const actual = view.row(row.token);
      equal(actual.fileOffset, row.fileOffset, 'row file offset');
      const encoded = new Uint8Array(actual.byteLength);
      const data = new DataView(encoded.buffer);
      for (const column of Object.values(actual.columns)) {
        const offset = column.fileOffset - actual.fileOffset;
        if (column.width === 2) data.setUint16(offset, column.raw, true);
        else data.setUint32(offset, column.raw, true);
      }
      equal(hex(encoded), row.bytes, 'complete row scalar dump');
      rowCount++;
    }
  }
  for (const expected of native.namedRows) {
    const actual = view.row(expected.token);
    for (const [name, value] of Object.entries(expected.columns)) {
      const column = actual.columns[name];
      const decoded = column.kind === 'guid' ? column.display : column.value instanceof Uint8Array
        ? hex(column.value) : column.value?.token ?? column.value;
      equal(decoded, value, `${actual.tableName}.${name}`);
    }
  }
  for (const expected of native.heaps) {
    const heap = view.heaps().find(heap => heap.name === expected.name);
    for (const property of ['byteLength', 'fileOffset']) equal(heap[property], expected[property], `${heap.name} ${property}`);
    for (const entry of expected.entries) {
      const actual = view.heapEntry(expected.name, entry.index);
      equal(expected.name === '#GUID' ? actual.display : actual.value instanceof Uint8Array ? hex(actual.value) : actual.value,
        entry.value, `${expected.name} handle ${entry.index}`);
    }
  }
  return { tables: tables.length, rows: rowCount, namedRows: native.namedRows.length, heaps: native.heaps.length };
}
