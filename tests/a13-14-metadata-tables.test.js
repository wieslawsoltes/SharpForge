import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, CilError, MetadataBuilder, MetadataTableInspector, readPE, tableDefinitions } from '@sharpforge/cil';
import { tablesFixture, pdbTablesFixture, deltaTablesFixture } from './fixtures/metadata-table-views/fixture.js';
import { fixture as navigationFixture } from './fixtures/inspector-navigation/fixture.mjs';

test('all 45 CLI tables have named columns and exact physical scalar/row offsets', () => {
  const fixture = tablesFixture();
  const view = new MetadataTableInspector(fixture.bytes);
  const pe = readPE(fixture.bytes);
  const data = new DataView(fixture.bytes.buffer, fixture.bytes.byteOffset, fixture.bytes.byteLength);
  const tables = view.tables({ includeEmpty: false });
  assert.deepEqual(tables.map(table => table.table), Array.from({ length: 45 }, (_, index) => index));
  assert.equal(view.tables().length, 53);
  for (const table of tables) {
    const page = view.rows(table.name);
    assert.equal(page.total, table.rowCount);
    assert.equal(page.nextOffset, null);
    for (const row of page.rows) {
      assert.deepEqual(Object.keys(row.columns), tableDefinitions[table.table].columns);
      assert.equal(row.fileOffset, pe.metadataOffset + pe.metadata.tableOffset + pe.metadata.rowOffsets[table.table][row.rowId - 1]);
      assert.equal(row.metadataOffset + pe.metadataOffset, row.fileOffset);
      assert.equal(row.byteLength, table.rowSize);
      let columnOffset = row.fileOffset;
      for (const column of Object.values(row.columns)) {
        assert.equal(column.fileOffset, columnOffset);
        assert.equal(column.raw, column.width === 2 ? data.getUint16(columnOffset, true) : data.getUint32(columnOffset, true));
        columnOffset += column.width;
      }
      assert.equal(columnOffset, row.fileOffset + row.byteLength);
    }
  }
});

test('heap values, declared reference names, pointer lists and EnC tokens preserve physical identity', () => {
  const fixture = tablesFixture();
  const view = new MetadataTableInspector(fixture.metadata);
  const owner = view.row(fixture.owner);
  assert.equal(owner.columns.Name.value, 'Owner');
  assert.equal(owner.columns.Namespace.value, 'Fixture');
  assert.equal(owner.columns.Extends.value.name, 'Object');
  assert.equal(owner.columns.Extends.value.namespace, 'System');
  assert.equal(owner.columns.FieldList.physicalKind, 't3');
  assert.equal(owner.columns.FieldList.value.first.token, 0x03000001);
  assert.equal(owner.columns.FieldList.value.table, 4);
  assert.equal(view.row(0x03000001).columns.Field.value.token, fixture.field);
  assert.equal(view.row(0x03000001).columns.Field.value.name, 'Number');
  assert.equal(view.row(fixture.module).columns.FieldList.value.status, 'empty');
  assert.equal(view.row(fixture.module).columns.FieldList.value.first, null);
  assert.equal(view.row(fixture.nested).columns.FieldList.value.status, 'empty');
  assert.equal(view.row(0x1e000001).columns.Token.value.token, fixture.owner);
  assert.equal(view.row(0x1f000001).columns.Token.value.name, 'Owner');
  assert.equal(view.row(fixture.owner, { resolveTokens: false }).columns.Extends.value, 0x01000001);
  assert.deepEqual(view.row(fixture.field).columns.Signature.value, new Uint8Array([6, 8]));
});

test('paging visits requested rows only and never requests a method body or decorated display', () => {
  const inspector = new AssemblyInspector(navigationFixture(2000).bytes);
  const view = new MetadataTableInspector(inspector);
  inspector.pe.methodBody = () => { throw new Error('Unexpected method body read'); };
  inspector.metadata.rows[6][0][3] = 0xffffffff;
  const page = view.rows('MethodDef', { offset: 1997, limit: 2 });
  assert.deepEqual(page.rows.map(row => row.columns.Name.value), ['M1997', 'M1998']);
  assert.equal(page.total, 2000);
  assert.equal(page.nextOffset, 1999);
  assert.equal(view.rows(6, { offset: 2000 }).nextOffset, null);
  assert.deepEqual(view.rows(6, { limit: 0, maxPageBytes: 0 }).rows, []);
  assert.equal(view.rows(55).total, 0);
  assert.equal(inspector.cache.size, 0);
});

test('Portable PDB views expose eight schemas and wide external references without invented local rows', () => {
  for (const count of [65535, 65536]) {
    const fixture = pdbTablesFixture(count);
    const view = new MetadataTableInspector(fixture.bytes);
    assert.deepEqual(view.tables({ includeEmpty: false }).map(table => table.table), [48, 49, 50, 51, 52, 53, 54, 55]);
    const method = view.row(0x32000001).columns.Method;
    assert.equal(method.width, count === 65536 ? 4 : 2);
    assert.equal(method.value.token, 0x06000000 + count);
    assert.equal(method.value.status, 'external');
    assert.equal(method.value.fileOffset, null);
    assert.equal(view.rows('MethodDef').total, 0);
    assert.equal(view.tables().find(table => table.name === 'MethodDef').externalRowCount, count);
    assert.equal(view.row(0x37000001).columns.Parent.value.status, 'external');
    assert.equal(view.row(0x32000001).columns.VariableList.value.first.name, 'local');
  }
});

test('raw roots, ArrayBuffers, parsed PEs and subarray images share source-relative file coordinates', () => {
  const fixture = tablesFixture();
  const root = new MetadataTableInspector(fixture.metadata.buffer);
  const original = new MetadataTableInspector(fixture.bytes);
  const prefixed = new Uint8Array(fixture.bytes.length + 29);
  prefixed.set(fixture.bytes, 17);
  const bytes = prefixed.subarray(17, 17 + fixture.bytes.length);
  for (const source of [bytes, readPE(bytes)]) {
    const view = new MetadataTableInspector(source);
    assert.deepEqual(view.row(fixture.owner), original.row(fixture.owner));
    assert.deepEqual(view.streams(), original.streams());
  }
  const row = root.row(fixture.owner);
  assert.equal(row.fileOffset, row.metadataOffset);
  assert.equal(original.row(fixture.owner).fileOffset, row.fileOffset + readPE(fixture.bytes).metadataOffset);
});

test('minimal delta widths reuse the reader seam while aggregate handles never alias local records', () => {
  const view = new MetadataTableInspector(deltaTablesFixture());
  const local = view.row(0x33000001);
  assert.equal(local.columns.Attributes.width, 2);
  assert.equal(local.columns.Index.width, 2);
  assert.equal(local.columns.Name.width, 4);
  assert.equal(local.byteLength, 8);
  assert.equal(local.columns.Name.raw, 1);
  assert.equal(local.columns.Name.value, null);
  assert.equal(local.columns.Name.heap.reason, 'delta-context-required');
  assert.equal(view.heapEntry('#Strings', 1).value, 'A');
  const document = view.row(0x31000001).columns.Document;
  assert.equal(document.width, 4);
  assert.equal(document.value.token, 0x30000001);
  assert.equal(document.value.status, 'unresolved');
  assert.equal(document.value.fileOffset, null);
  assert.equal(view.row(0x32000001).columns.VariableList.value.status, 'unresolved');
  assert.equal(view.row(0x31000001, { resolveTokens: false }).columns.Document.value, 0x30000001);
  assert.equal(view.row(0x30000001).columns.HashAlgorithm.heap.status, 'unresolved');
});

test('invalid and nil row references stay explicit; reserved tags and overflow never wrap to valid tokens', () => {
  const fixture = tablesFixture();
  const pe = readPE(fixture.bytes);
  const view = new MetadataTableInspector(pe);
  pe.metadata.rows[3][0][0] = 2;
  assert.equal(view.row(0x03000001).columns.Field.value.status, 'invalid');
  pe.metadata.rows[3][0][0] = 0;
  assert.equal(view.row(0x03000001).columns.Field.value.status, 'nil');
  pe.metadata.rows[2][1][3] = 7;
  assert.throws(() => view.row(fixture.owner), /Invalid TypeDefOrRef tag/);
  const builder = new MetadataBuilder('Wide');
  builder.rows[4] = Array.from({ length: 65536 }, () => [0, 0, 0]);
  builder.add(3, [0x1000001]);
  builder.uncompressed = true;
  assert.throws(() => new MetadataTableInspector(builder.finish()).row(0x03000001), /24-bit token range/);
  assert.throws(() => new MetadataTableInspector({ bytes: fixture.bytes, metadata: {} }), CilError);
});

test('invalid pages, budgets, cancellation and disposal reject without publishing partial results', () => {
  const fixture = tablesFixture();
  const view = new MetadataTableInspector(fixture.bytes);
  for (const options of [{ offset: -1 }, { offset: 5 }, { offset: 0.5 }, { offset: NaN }, { limit: -1 },
    { limit: 1001 }, { limit: '1' }, { limit: Infinity }, { maxPageBytes: -1 }, { maxPageBytes: 4194305 },
    { maxEntryBytes: 1048577 }, { resolveTokens: 1 }, { resolveTokens: null }, { offset: null }, { limit: null },
    null, [], 1]) assert.throws(() => view.rows(2, options), CilError);
  for (const value of [0, -1, 0x02000000, 0x02000005, 0x100000001, 1.5, '1', 1n, Symbol()])
    assert.throws(() => view.row(value), CilError);
  for (const table of [45, 47, 56, -1, 'typedef', {}, null]) assert.throws(() => view.rows(table), CilError);
  assert.throws(() => view.tables({ includeEmpty: 1 }), CilError);
  assert.throws(() => view.rows(2, { maxPageBytes: 1 }), /budget exceeded/);
  assert.throws(() => view.rows(2, { signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => view.streams({ signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => new MetadataTableInspector(fixture.bytes, { maxBytes: fixture.bytes.length - 1 }), /byte limit/);
  assert.throws(() => new MetadataTableInspector(fixture.bytes, { signal: AbortSignal.abort() }), /cancelled/);
  const field = view.row(fixture.field);
  field.columns.Signature.value[0] = 255;
  field.columns.Name.value = 'changed';
  assert.equal(view.row(fixture.field).columns.Signature.value[0], 6);
  assert.equal(view.row(fixture.field).columns.Name.value, 'Number');
  const tables = view.tables();
  tables[0].columns[0].name = 'changed';
  assert.equal(view.tables()[0].columns[0].name, 'Generation');
  view.dispose();
  view.dispose();
  assert.throws(() => view.tables(), /disposed/);
  assert.throws(() => view.heapEntry('#GUID', 0), /disposed/);
});
