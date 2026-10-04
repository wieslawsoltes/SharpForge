import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decompileAssembly } from '@sharpforge/cil';
import { createMetadataInventory, finishMetadataInventory } from '../packages/cil/src/decompiler/inventory.js';
import { inventoryOptions } from '../packages/cil/src/decompiler/inventory-contracts.js';

const referenceBytes = readFileSync(new URL('./fixtures/metadata-table-views/native.json', import.meta.url));
const reference = JSON.parse(referenceBytes);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const imageBytes = (image) => {
  const bytes = Buffer.from(image.image, 'base64');
  assert.equal(hash(bytes), image.sha256);
  return bytes;
};

test('inventory counts and every physical row identity match retained native SRM observations', () => {
  assert.equal(hash(referenceBytes), 'b9fe9c749515f4d14ab4da150b00a7f4bd33037d7bb903c40e03c67d865f05b7');
  assert.equal(reference.compilation.exitCode, 0);
  assert.equal(reference.execution.exitCode, 0);
  assert.equal(reference.execution.signal, null);
  assert.equal(reference.images.length, 3);
  for (const input of reference.images) {
    const bytes = imageBytes(input);
    const inventory = input.label === 'srm-cli-tables-pe' ? decompileAssembly(bytes).inventory :
      finishMetadataInventory(createMetadataInventory(bytes, inventoryOptions()), []);
    const native = reference.native.images.find((image) => image.label === input.label);
    assert(native, input.label);
    assert.deepEqual(inventory.tables.filter((table) => table.rowCount).map((table) => [table.table, table.rowCount]),
      native.tables.map((table) => [table.table, table.rowCount]));
    let total = 0;
    for (const expected of native.tables) {
      const table = inventory.tables.find((item) => item.table === expected.table);
      assert.deepEqual(table.rows.map((row) => row.token), expected.rows.map((row) => row.token));
      for (const [index, row] of table.rows.entries()) {
        assert.equal(row.fileOffset, expected.rows[index].fileOffset);
        assert.equal(row.byteLength, expected.rowSize);
        const encoded = new Uint8Array(row.byteLength);
        const view = new DataView(encoded.buffer);
        table.columns.forEach((column, position) => {
          if (column.width === 2) view.setUint16(column.offset, row.raw[position], true);
          else view.setUint32(column.offset, row.raw[position], true);
        });
        assert.equal(Buffer.from(encoded).toString('hex').toUpperCase(), expected.rows[index].bytes);
        const typed = native.namedRows.find((item) => item.token === row.token);
        for (const [name, value] of Object.entries(row.summary?.strings ?? {})) {
          if (typed && Object.hasOwn(typed.columns, name)) assert.equal(value, typed.columns[name]);
        }
      }
      total += expected.rowCount;
    }
    assert.equal(inventory.totalRows, total);
    assert.equal(inventory.accountedRows, total);
    assert.equal(inventory.accountingComplete, true);
    assert.equal(inventory.sourceComplete, false);
  }
});

test('native rejection of four legacy tables remains explicit while their physical rows remain inventoried', () => {
  assert.deepEqual(reference.unsupportedImages.map((image) => image.table), [33, 34, 36, 37]);
  for (const input of reference.unsupportedImages) {
    const bytes = imageBytes(input);
    const native = reference.native.unsupportedImages.find((image) => image.label === input.label);
    assert.equal(native.accepted, false);
    assert.equal(native.exception, 'System.BadImageFormatException');
    assert(native.message.startsWith('Unknown tables: '));
    const inventory = finishMetadataInventory(createMetadataInventory(bytes, inventoryOptions()), []);
    assert.equal(inventory.tables.find((table) => table.table === input.table).rows.length, 1);
    assert.equal(inventory.tables.filter((table) => table.rowCount).length, 42);
    assert.equal(inventory.accountingComplete, true);
    assert.equal(inventory.sourceComplete, false);
  }
});
