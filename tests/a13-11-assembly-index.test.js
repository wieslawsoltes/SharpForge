import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, AssemblySymbolIndex, CilError } from '@sharpforge/cil';
import { assemblyFixture } from './fixtures/assembly-index/fixture.mjs';

const inspect = (module = 1, methods = 10, order = null) => new AssemblyInspector(assemblyFixture(module, methods, order));
const nativeRoot = new URL('./fixtures/portable-pdb-unnamed-slots/', import.meta.url);

test('assembly index bounds 20 loaded assemblies and keeps IDs stable across reloads', () => {
  const images = Array.from({ length: 20 }, (_, index) => assemblyFixture(index + 1, 1000));
  const loaded = images.map(image => new AssemblyInspector(image));
  const index = new AssemblySymbolIndex(loaded, { assemblies: 20, entries: 20120, nameBytes: 256000, bytes: 6000000 });
  assert.equal(index.size, 20120);
  assert.equal(index.modules().length, 20);
  assert.ok(index.storage.nameBytes <= 256000);
  assert.ok(index.storage.bytes <= 6000000);
  const again = new AssemblySymbolIndex(images.map(image => new AssemblyInspector(image)));
  for (let offset = 0; offset < index.size; offset += 1000) {
    const page = index.page({ offset, limit: 1000 });
    assert.deepEqual(page, again.page({ offset, limit: 1000 }));
    for (const entry of page.entries) assert.deepEqual(index.get(entry.id), entry);
  }
  assert.ok(loaded.every(assembly => assembly.cache.size === 0));
});

test('assembly index covers type, field, method, property and event definitions with owned scalar records', () => {
  const inspector = inspect();
  const index = new AssemblySymbolIndex([inspector]);
  const entries = index.page().entries;
  assert.deepEqual([...new Set(entries.map(entry => entry.kind))].sort(), ['event', 'field', 'method', 'property', 'type']);
  const owner = entries.find(entry => entry.kind === 'type' && entry.name === 'Index.Fixture');
  const method = entries.find(entry => entry.kind === 'method');
  assert.equal(method.declaringTypeId, owner.id);
  assert.equal(method.id, inspector.tokenUri(method.token));
  assert.ok(entries.some(entry => entry.kind === 'type' && entry.name.endsWith('Inner')));
  const snapshot = index.get(method.id);
  method.name = 'changed';
  inspector.methods.get(snapshot.token).name = 'changed input';
  inspector.pe.bytes.fill(0);
  index.modules()[0].mvid = 'changed';
  index.storage.entries = 0;
  assert.deepEqual(index.get(snapshot.id), snapshot);
  assert.equal(index.storage.entries, index.size);
  assert.notEqual(index.modules()[0].mvid, 'changed');
});

test('assembly index retains pointer-table ownership without reading method signatures or bodies', () => {
  const inspector = inspect(1, 3, [3, 1, 2]);
  inspector.metadata.blob = () => { throw Error('Unexpected signature read'); };
  inspector.getMethod = () => { throw Error('Unexpected body read'); };
  const index = new AssemblySymbolIndex([inspector]);
  const methods = index.page().entries.filter(entry => entry.kind === 'method');
  assert.deepEqual(methods.map(entry => entry.token), [0x06000003, 0x06000001, 0x06000002]);
  assert.ok(methods.every(entry => entry.declaringTypeId === inspector.tokenUri(0x02000002)));
  assert.equal(inspector.cache.size, 0);
});

test('assembly index preflights every aggregate limit and rejects invalid limits before projection', () => {
  const inspector = inspect();
  const exact = new AssemblySymbolIndex([inspector]).storage;
  assert.equal(new AssemblySymbolIndex([inspector], exact).size, exact.entries);
  for (const key of ['assemblies', 'entries', 'nameBytes', 'bytes']) {
    assert.throws(() => new AssemblySymbolIndex([inspector], { [key]: exact[key] - 1 }), CilError);
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      assert.throws(() => new AssemblySymbolIndex([inspector], { [key]: invalid }), CilError);
  }
  Object.defineProperty(inspector, 'types', { get() { throw Error('Counts must precede projection'); } });
  assert.throws(() => new AssemblySymbolIndex([inspector], { entries: 0 }), /entry limit/);
  assert.throws(() => new AssemblySymbolIndex([inspector], { assemblies: 0 }), /assembly limit/);
});

test('assembly index rejects duplicate MVIDs, corrupt ownership, raw token aliases and oversized names', () => {
  assert.throws(() => new AssemblySymbolIndex([inspect(), inspect()]), /Duplicate module/);
  assert.throws(() => new AssemblySymbolIndex([{}]), /loaded AssemblyInspectors/);
  const duplicate = inspect();
  duplicate.types[1].methods[1].token = duplicate.types[1].methods[0].token;
  assert.throws(() => new AssemblySymbolIndex([duplicate]), /Duplicate definition/);
  const missing = inspect();
  missing.types[1].methods.pop();
  assert.throws(() => new AssemblySymbolIndex([missing]), /Incomplete/);
  for (const token of [0, -1, 0x100000000 + 0x06000001, 0x04000001, 0x0600ffff]) {
    const inspector = inspect();
    inspector.types[1].methods[0].token = token;
    assert.throws(() => new AssemblySymbolIndex([inspector]), CilError);
  }
  const huge = inspect();
  huge.types[1].methods[0].name = 'x'.repeat(4097);
  assert.throws(() => new AssemblySymbolIndex([huge]), /definition name/);
});

test('assembly index paging, unknown IDs, empty input and cancellation have bounded outcomes', () => {
  const empty = new AssemblySymbolIndex([]);
  assert.deepEqual(empty.page(), { entries: [], total: 0, nextOffset: null });
  const index = new AssemblySymbolIndex([inspect()]);
  assert.deepEqual(index.page({ offset: index.size }), { entries: [], total: index.size, nextOffset: null });
  assert.deepEqual(index.page({ limit: 0 }), { entries: [], total: index.size, nextOffset: null });
  assert.equal(index.get('unknown'), null);
  assert.throws(() => index.get('x'.repeat(62)), CilError);
  for (const options of [{ offset: -1 }, { offset: index.size + 1 }, { limit: 1001 }, { limit: 0.5 }])
    assert.throws(() => index.page(options), CilError);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => new AssemblySymbolIndex([], { signal: controller.signal }), /cancelled/);
  assert.throws(() => index.page({ signal: controller.signal }), /cancelled/);
  let reads = 0;
  assert.throws(() => new AssemblySymbolIndex([inspect(1, 1000)], { signal: { get aborted() { return ++reads > 5; } } }), /cancelled/);
});

test('assembly index matches retained native method tokens and names without native execution', () => {
  const bytes = readFileSync(new URL('UnnamedSlots.dll', nativeRoot));
  const oracle = JSON.parse(readFileSync(new URL('reference.json', nativeRoot), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), oracle.reference.assemblySha256);
  const inspector = new AssemblyInspector(bytes);
  const index = new AssemblySymbolIndex([inspector]);
  for (const expected of oracle.native.methods) {
    const actual = index.get(inspector.tokenUri(expected.token));
    assert.equal(actual.token, expected.token);
    assert.equal(actual.name, expected.name);
    assert.equal(actual.kind, 'method');
  }
  assert.equal(inspector.cache.size, 0);
});
