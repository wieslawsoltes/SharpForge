import test from 'node:test';
import assert from 'node:assert/strict';
import { CilError, MetadataTableInspector, readPE } from '@sharpforge/cil';
import { heapFixture, tablesFixture, pdbTablesFixture } from './fixtures/metadata-table-views/fixture.js';

test('all heap handles retain owned decoded values and precise prefix/payload coordinates', () => {
  const fixture = heapFixture();
  const bytes = fixture.builder.finish();
  const view = new MetadataTableInspector(bytes);
  const heaps = new Map(view.heaps().map(heap => [heap.name, heap]));
  assert.equal(heaps.size, 4);
  const string = view.heapEntry('#Strings', fixture.string + 7);
  assert.equal(string.value, 'suffix');
  assert.equal(string.offset, fixture.string + 7);
  assert.equal(string.fileOffset, heaps.get('#Strings').fileOffset + string.offset);
  assert.equal(string.byteLength, 7);
  assert.equal(string.payloadByteLength, 6);
  for (const [position, length] of [0, 127, 128, 16383, 16384].entries()) {
    const entry = view.heapEntry('#Blob', fixture.blobs[position]);
    assert.equal(entry.value.length, length);
    assert.equal(entry.byteLength, length + (length < 128 ? 1 : length < 16384 ? 2 : 4));
    assert.equal(entry.payloadFileOffset + length, entry.fileOffset + entry.byteLength);
    assert.equal(entry.fileOffset, heaps.get('#Blob').fileOffset + entry.index);
    if (length) {
      entry.value[0] = 0;
      assert.equal(view.heapEntry('#Blob', entry.index).value[0], 42);
    }
  }
  const guid = view.heapEntry('#GUID', fixture.guid);
  assert.equal(guid.offset, (fixture.guid - 1) * 16);
  assert.equal(guid.display, '04030201-0605-0807-090a-0b0c0d0e0f10');
  guid.value.fill(0);
  assert.equal(view.heapEntry('#GUID', fixture.guid).value[0], 1);
  for (const item of fixture.userStrings) {
    const entry = view.heapEntry('#US', item.index);
    assert.equal(entry.value, item.value);
    assert.equal(entry.token, 0x70000000 + item.index);
    assert.equal(entry.payloadByteLength, item.value.length * 2 + 1);
    assert.equal(entry.isPadding, false);
  }
  assert.equal(view.heapEntry('#Strings', 0).value, '');
  assert.deepEqual(view.heapEntry('#Blob', 0).value, new Uint8Array());
  assert.equal(view.heapEntry('#US', 0).value, null);
  const nilGuid = view.heapEntry('#GUID', 0);
  assert.equal(nilGuid.isNil, true);
  assert.equal(nilGuid.fileOffset, null);
  assert.deepEqual(nilGuid.value, new Uint8Array(16));
});

test('physical heap paging follows byte cursors, includes nil records and distinguishes user-string padding', () => {
  const fixture = heapFixture();
  const padding = fixture.builder.heaps.userStrings.length;
  fixture.builder.heaps.userStrings.zero(3);
  const view = new MetadataTableInspector(fixture.builder.finish());
  for (const heap of view.heaps()) {
    const entries = [];
    let offset = 0;
    do {
      const page = view.heap(heap.name, { offset, limit: 2 });
      assert.equal(page.totalBytes, heap.byteLength);
      assert(page.entries.length <= 2);
      entries.push(...page.entries);
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(entries.reduce((bytes, entry) => bytes + entry.byteLength, 0), heap.byteLength);
    assert.equal(entries[0].index, heap.name === '#GUID' ? 1 : 0);
    assert.deepEqual(view.heap(heap.name, { offset: heap.byteLength }).entries, []);
    assert.equal(view.heap(heap.name, { limit: 0, maxPageBytes: 0 }).nextOffset, null);
  }
  const entries = view.heap('#US', { offset: padding }).entries;
  assert.equal(entries.length, 3);
  assert(entries.every(entry => entry.isPadding && entry.token === null && entry.byteLength === 1));
  assert.throws(() => view.heapEntry('#US', padding), /Invalid UTF-16 user string/);
  assert.throws(() => view.heap('#GUID', { offset: 1 }), /not aligned/);
});

test('byte limits preflight before existing decoders; repeated returned heap occurrences consume the page budget', () => {
  const fixture = tablesFixture();
  const pe = readPE(fixture.bytes);
  const view = new MetadataTableInspector(pe);
  let reads = 0;
  const decode = pe.metadata.blob;
  pe.metadata.blob = index => { reads++; return decode(index); };
  const index = fixture.probes['#Blob'][1];
  assert.throws(() => view.heapEntry('#Blob', index, { maxEntryBytes: 4 }), /entry byte budget/);
  assert.throws(() => view.heapEntry('#Blob', index, { maxPageBytes: 4 }), /page byte budget/);
  assert.equal(reads, 0);
  assert.equal(view.heapEntry('#Blob', index, { maxEntryBytes: 5, maxPageBytes: 5 }).byteLength, 5);
  assert.equal(reads, 1);
  const wide = heapFixture();
  const wideView = new MetadataTableInspector(wide.builder.finish());
  assert.throws(() => wideView.heap('#Blob', { maxPageBytes: 128 }), /page byte budget/);
  assert.throws(() => wideView.heapEntry('#Strings', wide.string, { maxEntryBytes: 5 }), /entry byte budget/);
  assert.throws(() => wideView.heapEntry('#GUID', wide.guid, { maxPageBytes: 15 }), /page byte budget/);
  let checks = 0;
  const signal = { get aborted() { return ++checks > 3; } };
  assert.throws(() => wideView.heap('#Blob', { signal }), /cancelled/);
});

test('missing heaps, malformed UTF-8/compressed records, nil indexes and invalid options remain distinct', () => {
  const pdb = new MetadataTableInspector(pdbTablesFixture(2).bytes);
  assert.deepEqual(pdb.heap('#US').entries, []);
  assert.equal(pdb.heapEntry('#US', 0).value, null);
  assert.throws(() => pdb.heapEntry('#US', 1), /absent/);
  const fixture = heapFixture();
  const bytes = fixture.builder.finish();
  const view = new MetadataTableInspector(bytes);
  for (const index of [-1, 0.5, NaN, Infinity, 0x100000000, '0', 1n, Symbol()])
    assert.throws(() => view.heapEntry('#Blob', index), CilError);
  for (const options of [{ offset: -1 }, { offset: 999999 }, { limit: 1001 }, { limit: NaN }, { maxEntryBytes: -1 }])
    assert.throws(() => view.heap('#Blob', options), CilError);
  assert.throws(() => view.heap('#unknown'), CilError);
  assert.throws(() => view.heapEntry('#Strings', 0xffffffff), /outside/);
  const heaps = new Map(view.heaps().map(heap => [heap.name, heap]));
  bytes[heaps.get('#Strings').fileOffset + fixture.string] = 255;
  assert.throws(() => view.heapEntry('#Strings', fixture.string), CilError);
  bytes[heaps.get('#Blob').fileOffset + fixture.blobs[1]] = 0xe0;
  assert.throws(() => view.heapEntry('#Blob', fixture.blobs[1]), /compressed integer/);
  bytes[heaps.get('#US').fileOffset + fixture.userStrings[0].index] = 2;
  assert.throws(() => view.heapEntry('#US', fixture.userStrings[0].index), /Invalid UTF-16/);
  bytes[heaps.get('#Blob').fileOffset] = 1;
  assert.throws(() => view.heapEntry('#Blob', 0), /Invalid metadata heap nil entry/);
  assert.throws(() => view.heapEntry('#GUID', fixture.guid + 1), /outside|Truncated/);
});
