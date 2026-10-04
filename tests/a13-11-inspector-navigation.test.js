import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, MetadataBuilder, Writer, writePE, CilError, inspectAssembly } from '@sharpforge/cil';

function fixture(count = 4, pointerOrder = null) {
  const metadata = new MetadataBuilder('Navigation', { uncompressed: !!pointerOrder });
  metadata.rows[0][0][2] = metadata.guid(Uint8Array.from({ length: 16 }, (_, index) => index + 1));
  const userString = metadata.userString('Navigation value');
  metadata.add(2, [1, metadata.string('Fixture'), 0, 0, 1, 1]);
  const signature = metadata.blob(new Uint8Array([0, 0, 1]));
  for (let index = 0; index < count; index++)
    metadata.add(6, [0x2048, 0, 0x16, metadata.string('M' + index), signature, 1]);
  for (const row of pointerOrder ?? []) metadata.add(5, [row]);
  const bytes = metadata.finish();
  const section = new Writer().zero(72).u8(6).u8(0x2a).pad();
  const offset = section.length;
  section.bytes(bytes);
  return { bytes: writePE(section.finish(), offset, bytes.length, 0), userString: 0x70000000 + userString };
}

test('20k-method pages decode exactly requested physical tokens and return owned results', () => {
  const input = fixture(20000),
    inspector = new AssemblyInspector(input.bytes);
  assert.equal(inspector.cache.size, 0);
  const page = inspector.summary({ methodOffset: 19997, methodLimit: 2 });
  assert.deepEqual(
    page.methods.map((method) => method.token),
    [0x06000000 + 19998, 0x06000000 + 19999],
  );
  assert.deepEqual(page.methodPage, { offset: 19997, limit: 2, total: 20000, nextOffset: 19999 });
  assert.equal(inspector.cache.size, 2);
  assert.equal(page.types, undefined);
  page.methods[0].instructions[0].name = 'changed';
  assert.equal(inspector.summary({ methodOffset: 19997, methodLimit: 1 }).methods[0].instructions[0].name, 'ret');
  const last = inspector.summary({ methodOffset: 19999, methodLimit: 100 });
  assert.equal(last.methods.length, 1);
  assert.equal(last.methodPage.nextOffset, null);
  assert.equal(inspector.cache.size, 3);
});

test('definition-only and empty pages decode no methods, including the exact end boundary', () => {
  const inspector = new AssemblyInspector(fixture().bytes);
  const page = inspector.summary({ methodOffset: 1, methodLimit: 2, includeMethods: false, maxPageCodeBytes: 0 });
  assert.equal(page.methods.length, 2);
  assert.equal(page.methods[0].instructions, undefined);
  assert.equal(inspector.cache.size, 0);
  assert.deepEqual(inspector.summary({ methodOffset: 4, methodLimit: 1 }).methods, []);
  assert.deepEqual(inspector.summary({ methodLimit: 0 }).methods, []);
  assert.equal(inspector.cache.size, 0);
});

test('pages use physical MethodDef order while legacy summaries retain MethodPtr owner order', () => {
  const inspector = new AssemblyInspector(fixture(4, [3, 1, 4, 2]).bytes);
  assert.deepEqual(
    inspector.summary({ includeMethods: false }).methods.map((method) => method.name),
    ['M2', 'M0', 'M3', 'M1'],
  );
  assert.deepEqual(
    inspector.summary({ methodOffset: 1, methodLimit: 2, includeMethods: false }).methods.map((method) => method.name),
    ['M1', 'M2'],
  );
  assert.equal(inspector.cache.size, 0);
});

test('pagination rejects malformed limits, offsets, aggregate body bytes and cancellation before decoding', () => {
  const inspector = new AssemblyInspector(fixture().bytes);
  for (const options of [
    { methodOffset: -1 },
    { methodOffset: 5 },
    { methodOffset: 1.5 },
    { methodOffset: NaN },
    { methodLimit: -1 },
    { methodLimit: 1001 },
    { methodLimit: Infinity },
    { methodLimit: '1' },
    { methodLimit: 1, maxPageCodeBytes: -1 },
    { methodLimit: 1, maxPageCodeBytes: 1024 * 1024 + 1 },
  ])
    assert.throws(() => inspector.summary(options), CilError);
  assert.throws(() => inspector.summary({ methodLimit: 2, maxPageCodeBytes: 1 }), /code budget exceeded/);
  assert.throws(() => inspector.summary({ methodLimit: 1, signal: AbortSignal.abort() }), /cancelled/);
  assert.equal(inspector.cache.size, 0);
  assert.equal(inspector.summary({ methodLimit: 2, maxPageCodeBytes: 2 }).methods.length, 2);
});

test('legacy summary retains complete inventory, definition-only mode and per-method diagnostics', () => {
  const input = fixture(),
    inspector = new AssemblyInspector(input.bytes);
  const definitions = inspector.summary({ includeMethods: false });
  assert.equal(definitions.methods.length, 4);
  assert(definitions.types.length > 0);
  assert.equal(definitions.methodPage, undefined);
  assert.equal(inspector.cache.size, 0);
  const summary = inspector.summary();
  assert.equal(summary.methods.length, 4);
  assert.equal(inspector.cache.size, 4);
  assert.deepEqual(inspectAssembly(input.bytes), summary);
  const malformed = new AssemblyInspector(input.bytes);
  malformed.pe.bytes[malformed.pe.offsetOf(0x2048)] = 0;
  const page = malformed.summary({ methodLimit: 1 });
  assert.match(page.methods[0].error, /Unsupported method header/);
  assert.equal(page.methods[0].codeSize, 0);
});

test('metadata URIs cover every declared row and user strings, surviving an inspector reload', () => {
  const input = fixture(),
    inspector = new AssemblyInspector(input.bytes),
    reload = new AssemblyInspector(input.bytes);
  for (const [table, rows] of Object.entries(inspector.metadata.rows)) {
    for (let index = 0; index < rows.length; index++) {
      const token = Number(table) * 0x1000000 + index + 1;
      const uri = inspector.tokenUri(token);
      assert.match(uri, /^sf-metadata:\/\/04030201-0605-0807-090a-0b0c0d0e0f10\/0x[\da-f]{8}$/);
      assert.deepEqual(reload.resolveUri(uri), { mvid: '04030201-0605-0807-090a-0b0c0d0e0f10', token });
      assert.equal(reload.tokenUri(reload.resolveUri(uri.toUpperCase()).token), uri);
    }
  }
  assert.equal(reload.resolveUri(inspector.tokenUri(input.userString)).token, input.userString);
  assert.equal(inspector.cache.size, 0);
  assert.equal(reload.cache.size, 0);
});

test('URI parsing rejects raw token coercion, bad heap extents, other modules and noncanonical components', () => {
  const input = fixture(),
    inspector = new AssemblyInspector(input.bytes),
    uri = inspector.tokenUri(0x06000001);
  for (const token of [0, -1, 1.5, NaN, 0x106000001, 0x06000005, 0x70000000, 0x70ffffff, '100663297', 1n, Symbol('t')])
    assert.throws(() => inspector.tokenUri(token), CilError);
  for (const invalid of [
    null,
    '',
    uri + '?x',
    uri + '#x',
    uri.replace('0x06000001', '0x06000005'),
    uri.replace('sf-metadata', 'https'),
    uri.replace('04030201', 'ffffffff'),
  ])
    assert.throws(() => inspector.resolveUri(invalid), CilError);
  inspector.metadata.rows[0][0][2] = 0;
  assert.throws(() => inspector.tokenUri(0x06000001), /MVID is unavailable/);
});

test('retained native Roslyn PE resolves method URIs after reload and preserves page/default descriptors', () => {
  const bytes = readFileSync(new URL('./fixtures/portable-pdb-unnamed-slots/UnnamedSlots.dll', import.meta.url));
  const inspector = new AssemblyInspector(bytes),
    reload = new AssemblyInspector(bytes);
  const summary = inspector.summary();
  for (const method of summary.methods)
    assert.equal(reload.resolveUri(inspector.tokenUri(method.token)).token, method.token);
  assert.equal(reload.cache.size, 0);
  const page = reload.summary({ methodLimit: 1 });
  assert.deepEqual(
    page.methods,
    summary.methods.filter((method) => method.token === 0x06000001),
  );
  assert.equal(reload.cache.size, 1);
});
