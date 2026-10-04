import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, CilError, MetadataBuilder, readMetadata, tableDefinitions, decompileAssembly } from '@sharpforge/cil';
import { createMetadataInventory, finishMetadataInventory } from '../packages/cil/src/decompiler/inventory.js';
import { inventoryOptions } from '../packages/cil/src/decompiler/inventory-contracts.js';
import { arithmeticLibrary, managedFixture } from './managed-fixtures.js';
import { tablesFixture, pdbTablesFixture, deltaTablesFixture } from './fixtures/metadata-table-views/fixture.js';

const failure = (code) => (error) => error instanceof CilError && error.code === code;
const inventory = (input, options, methods = []) => finishMetadataInventory(
  createMetadataInventory(input, inventoryOptions(options)), methods);
const parsedMetadata = (bytes) => ({ bytes, metadata: readMetadata(bytes), metadataOffset: 0,
  metadataDirectory: { size: bytes.length } });

function assertCensus(actual, expected) {
  const seen = new Set();
  let count = 0;
  for (const table of actual.tables) {
    assert.equal(table.rowCount, expected[table.table] ?? 0, table.name);
    assert.equal(table.rows.length, table.rowCount, table.name);
    assert.equal(table.rendered + table.summarized + table.unsupported, table.rowCount);
    for (const [index, row] of table.rows.entries()) {
      assert.equal(row.table, table.table);
      assert.equal(row.tableName, table.name);
      assert.equal(row.rowId, index + 1);
      assert.equal(row.token, table.table * 0x1000000 + row.rowId);
      assert.equal(seen.has(row.token), false);
      seen.add(row.token);
      assert(['rendered', 'summarized', 'unsupported'].includes(row.status));
      assert.equal(row.raw.length, tableDefinitions[table.table].columns.length);
      count++;
    }
  }
  assert.equal(count, Object.values(expected).reduce((sum, rows) => sum + rows, 0));
  assert.equal(actual.totalRows, count);
  assert.equal(actual.accountedRows, count);
  assert.equal(actual.rendered + actual.summarized + actual.unsupported, count);
  assert.equal(actual.accountingComplete, true);
  assert.equal(actual.sourceComplete, false);
}

test('decompile result accounts for every physical CLI table and explicitly unsupported payloads', () => {
  const fixture = tablesFixture();
  const inspector = new AssemblyInspector(fixture.bytes);
  const result = decompileAssembly(inspector);
  assertCensus(result.inventory, inspector.metadata.counts);
  assert.equal(result.inventory.tables.filter((table) => table.present).length, 45);
  const owner = result.inventory.tables[2].rows[1];
  assert.equal(owner.status, 'summarized');
  assert.equal(owner.summary.strings.Name, 'Owner');
  assert.equal(owner.summary.strings.Namespace, 'Fixture');
  assert.equal(result.inventory.tables.find((table) => table.table === 12).rows[0].status, 'unsupported');
  assert.equal(result.inventory.tables.find((table) => table.table === 31).rows[0].reason, 'unsupported-table');
  assert(result.inventory.diagnostics.some((diagnostic) => diagnostic.code === 'CILDI0006'));
  assert.equal(result.sourceComplete, false);
});

test('reconstructed bodies, IL fallback and absent bodies retain exact output links without a full-row rendered claim', () => {
  const result = decompileAssembly(arithmeticLibrary());
  assert.equal(result.reconstructed, 3);
  assert.equal(result.inventory.rendered, 0);
  const rows = result.inventory.tables.find((table) => table.table === 6).rows;
  for (const [index, row] of rows.entries()) {
    assert.equal(row.status, 'summarized');
    assert.deepEqual(row.renderedOutput, { resultIndex: index, extent: 'method-body', language: 'csharp' });
    assert.equal(row.token, result.methods[index].token);
  }
  const fallback = decompileAssembly(managedFixture({ methods: [
    { name: 'InvalidFlow', body: (writer) => writer.op('nop') },
    { name: 'Abstract', noBody: true, flags: 0x5c6, static: false },
  ] }));
  const other = fallback.inventory.tables.find((table) => table.table === 6).rows;
  assert.equal(other[0].renderedOutput.extent, 'cil-listing');
  assert.equal(other[1].renderedOutput.extent, 'absence-diagnostic');
  assert.equal(fallback.sourceComplete, false);
});

test('orphan physical MethodDefs and invalid method bodies stay in the census exactly once', () => {
  const inspector = new AssemblyInspector(arithmeticLibrary());
  inspector.methods.delete(0x06000002);
  inspector.metadata.rows[6][2][4] = 0xffff;
  const result = decompileAssembly(inspector);
  assertCensus(result.inventory, inspector.metadata.counts);
  const rows = result.inventory.tables.find((table) => table.table === 6).rows;
  assert.equal(rows[1].reason, 'method-result-unavailable');
  assert.equal(rows[1].status, 'unsupported');
  assert.equal(rows[2].status, 'unsupported');
  assert.equal(rows[2].renderedOutput, undefined);
  assert(result.methods.some((method) => method.diagnostics[0]?.code === 'INVALID_METHOD'));
});

test('standalone PDB external ranges never create rows and delta identities stay physical', () => {
  const pdb = pdbTablesFixture(2).bytes;
  const snapshot = inventory(pdb);
  assertCensus(snapshot, readMetadata(pdb).counts);
  const methods = snapshot.tables.find((table) => table.table === 6);
  assert.equal(methods.rowCount, 0);
  assert.equal(methods.externalRowCount, 2);
  assert.equal(snapshot.tables.filter((table) => table.rowCount).length, 8);
  const delta = inventory(deltaTablesFixture());
  assert.equal(delta.minimalDelta, true);
  assert.equal(delta.summarized, 0);
  assert(delta.tables.flatMap((table) => table.rows).every((row) => row.reason === 'generation-context-required'));
  assert.equal(delta.tables.find((table) => table.table === 51).rows[0].token, 0x33000001);
});

test('invalid summary heaps preserve physical rows with an explicit unsupported diagnostic', () => {
  const builder = new MetadataBuilder('MalformedSummary');
  builder.add(26, [0xffff]);
  const result = inventory(builder.finish());
  const row = result.tables.find((table) => table.table === 26).rows[0];
  assert.equal(row.status, 'unsupported');
  assert.equal(row.reason, 'invalid-row-summary');
  assert.equal(row.diagnostic.code, 'CILDI0005');
  assert.equal(row.raw[0], 0xffff);
});

test('the public pipeline retains unsupported names and opaque attributes without a second full summary traversal', () => {
  for (const table of [35, 42, 12, 32]) {
    const bytes = managedFixture({ decorate: ({ md, type }) => {
      if (table === 35) md.rows[35][0][6] = 0xffff;
      if (table === 42) md.add(42, [0, 0, (type & 0xffffff) * 2, 0xffff]);
      if (table === 12) md.add(12, [1, 0, 0xffff]);
      if (table === 32) md.rows[32][0][7] = 0xffff;
    } });
    const result = decompileAssembly(bytes);
    const row = result.inventory.tables.find((item) => item.table === table).rows[0];
    assert.equal(row.status, 'unsupported');
    assert.equal(result.inventory.accountingComplete, true);
    if (table !== 12) assert.equal(row.diagnostic.code, 'CILDI0005');
    if (table === 32) assert.equal(result.name, null);
    else assert.equal(result.name, 'ManagedFixture');
  }
});

test('repeated failed name scans are cached and distinct invalid suffixes share the scan budget', () => {
  function input(distinct) {
    const builder = new MetadataBuilder('FailedNameBudget');
    const name = builder.string('x'.repeat(1024));
    for (let index = 0; index < 12; index++) builder.add(26, [name + (distinct ? index : 0)]);
    const parsed = parsedMetadata(builder.finish());
    parsed.metadata.streams.get('#Strings').fill(120, name);
    return parsed;
  }
  const repeated = inventory(input(false), { maxBytes: 2048, maxEntryBytes: 2048 });
  assert(repeated.summaryBytes >= 1025, 'Failed scanned prefix must be charged');
  assert.equal(repeated.tables.find((table) => table.table === 26).unsupported, 12);
  assert.throws(() => inventory(input(true), { maxBytes: 2048, maxEntryBytes: 2048 }), failure('CILDI0002'));
});

test('inventory budgets allow exact extents and preflight oversized census before reading rows', () => {
  const input = tablesFixture().metadata;
  const normal = inventory(input);
  assert.deepEqual(inventory(input, { maxRows: normal.totalRows, maxBytes: normal.summaryBytes }), normal);
  assert.throws(() => inventory(input, { maxRows: normal.totalRows - 1 }), failure('CILDI0002'));
  assert.throws(() => inventory(input, { maxBytes: normal.summaryBytes - 1 }), failure('CILDI0002'));
  assert.throws(() => inventory(input, { maxEntryBytes: 0 }), failure('CILDI0002'));
  const parsed = parsedMetadata(input);
  Object.defineProperty(parsed.metadata.rows[2], 0, { get() { assert.fail('Over-budget row was inspected'); } });
  assert.throws(() => inventory(parsed, { maxRows: 0 }), failure('CILDI0002'));
  assert.throws(() => inventory(parsed, { maxBytes: 0 }), failure('CILDI0002'));
});

test('empty physical inventories accept zero budgets and row identities cross the 16-bit boundary', () => {
  const empty = new MetadataBuilder('EmptyInventory');
  empty.rows = { 0: [] };
  const snapshot = inventory(empty.finish(), { maxRows: 0, maxBytes: 0, maxEntryBytes: 0 });
  assertCensus(snapshot, { 0: 0 });
  assert.equal(snapshot.tables[0].present, true);
  assert.equal(snapshot.tables[1].present, false);
  const bytes = pdbTablesFixture(65536).bytes;
  const wide = inventory(bytes);
  assertCensus(wide, readMetadata(bytes).counts);
  assert.equal(wide.tables.find((table) => table.table === 49).rows.at(-1).token, 0x31010000);
});

test('invalid inventory options, mismatched table containers and duplicate output tokens reject explicitly', () => {
  for (const value of [null, [], 0]) assert.throws(() => inventoryOptions(value), failure('CILDI0001'));
  for (const key of ['maxRows', 'maxBytes', 'maxEntryBytes']) for (const value of [-1, 0.5, NaN, Infinity, 2 ** 32]) {
    assert.throws(() => inventoryOptions({ [key]: value }), failure('CILDI0001'));
  }
  const input = tablesFixture().metadata;
  for (const change of [
    (md) => md.rows[2].pop(), (md) => { md.counts[60] = 1; },
    (md) => { delete md.counts[2]; }, (md) => { md.rows[2][0] = []; },
    (md) => { md.rows[2][0][0] = -1; }, (md) => { md.rows = null; },
  ]) {
    const parsed = parsedMetadata(input);
    change(parsed.metadata);
    assert.throws(() => inventory(parsed), failure('CILDI0004'));
  }
  const snapshot = createMetadataInventory(arithmeticLibrary(), inventoryOptions());
  const method = { token: 0x06000001, complete: true, language: 'csharp', source: 'body', diagnostics: [] };
  assert.throws(() => finishMetadataInventory(snapshot, [method, method]), failure('CILDI0001'));
  assert.throws(() => finishMetadataInventory(snapshot, [{ ...method, token: 0x0600ffff }]), failure('CILDI0001'));
});

test('inventory snapshots are independent of later source/output mutation and cancellation returns no partial result', () => {
  const inspector = new AssemblyInspector(arithmeticLibrary());
  const result = decompileAssembly(inspector);
  const before = structuredClone(result.inventory);
  inspector.metadata.rows[2][1][0] = 0;
  assert.deepEqual(result.inventory, before);
  result.inventory.tables[2].rows[1].raw[0] = 42;
  result.inventory.tables[2].columns[0].name = 'changed';
  const after = decompileAssembly(inspector).inventory;
  assert.equal(after.tables[2].rows[1].raw[0], 0);
  assert.equal(after.tables[2].columns[0].name, 'Flags');
  assert.throws(() => decompileAssembly(inspector, { signal: AbortSignal.abort() }), failure('CILCFG0003'));
  assert.throws(() => inventoryOptions({}, AbortSignal.abort()), failure('CILDI0003'));
  const limits = inventoryOptions();
  let polls = 0;
  limits.signal = { get aborted() { return ++polls > 100; } };
  assert.throws(() => createMetadataInventory(tablesFixture().metadata, limits), failure('CILDI0003'));
  let earlyPolls = 0;
  assert.throws(() => createMetadataInventory(tablesFixture().metadata, {
    ...inventoryOptions(), signal: { get aborted() { return ++earlyPolls >= 2; } },
  }), failure('CILDI0003'));
  const empty = new MetadataBuilder('EmptyCancelled');
  empty.rows = {};
  assert.throws(() => finishMetadataInventory(createMetadataInventory(empty.finish(), inventoryOptions()), [], AbortSignal.abort()),
    failure('CILDI0003'));
});
