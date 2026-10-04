import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, AssemblySymbolIndex, CilError } from '@sharpforge/cil';
import { typeFixture } from './fixtures/symbol-search/fixture.mjs';
import { assemblyFixture } from './fixtures/assembly-index/fixture.mjs';

const make = names => new AssemblySymbolIndex([new AssemblyInspector(typeFixture(names))]);
const names = result => result.entries.map(entry => entry.name);

test('search over 50,000 types supports all modes, deterministic pages and total result caps', () => {
  const inspector = new AssemblyInspector(typeFixture());
  const index = new AssemblySymbolIndex([inspector]);
  assert.equal(index.size, 50001);
  assert.deepEqual(index.searchStorage, { entries: 0, bytes: 0 });
  const first = index.search('searchtype49', { mode: 'prefix', limit: 37 });
  assert.equal(first.entries.length, 37);
  assert.equal(first.entries[0].id, inspector.tokenUri(0x02000002 + 49000));
  assert.equal(first.nextOffset, 37);
  assert.equal(first.capped, false);
  const next = index.search('searchtype49', { mode: 'prefix', offset: first.nextOffset, limit: 37 });
  assert.equal(next.entries[0].id, inspector.tokenUri(0x02000002 + 49037));
  assert.equal(index.search('Type4999', { limit: 1000 }).entries.length, 10);
  const capped = index.search('ST4', { mode: 'camel', limit: 1000, resultLimit: 256 });
  assert.equal(capped.entries.length, 256);
  assert.equal(capped.capped, true);
  assert.equal(capped.nextOffset, null);
  assert.equal(index.search('ST4', { mode: 'camel', offset: 255, limit: 8, resultLimit: 256 }).entries.length, 1);
  assert.deepEqual(index.search('DoesNotExist'), { entries: [], nextOffset: null, capped: false });
  assert.equal(inspector.cache.size, 0);
});

test('search defines qualified/simple prefix, literal substring and Unicode camel-initial matching', () => {
  const index = make(['NullReferenceException', 'XMLReader', 'foo_bar', 'ÉclairFactory', '中文_类型',
    'A2Parser', 'İstanbulIndex', '\u{10400}Name', 'école']);
  assert.deepEqual(names(index.search('fixtures.null', { mode: 'prefix' })), ['Fixtures.NullReferenceException']);
  assert.deepEqual(names(index.search('reference', { mode: 'substring' })), ['Fixtures.NullReferenceException']);
  for (const [query, expected] of [['nre', 'NullReferenceException'], ['xr', 'XMLReader'], ['fb', 'foo_bar'],
    ['éf', 'ÉclairFactory'], ['中类', '中文_类型'], ['a2p', 'A2Parser'], ['İI', 'İstanbulIndex'], ['\u{10428}n', '\u{10400}Name']]) {
    assert.ok(names(index.search(query, { mode: 'camel' })).includes('Fixtures.' + expected));
  }
  assert.deepEqual(names(index.search('ÉCO', { mode: 'prefix' })), ['Fixtures.école']);
  assert.deepEqual(names(index.search('e\u0301co')), []); // No NFC equivalence is implied.
  assert.deepEqual(names(index.search('.*')), []); // No regular expression or wildcard evaluation.
  assert.deepEqual(names(index.search(' null ')), []); // Whitespace is literal.
});

test('search returns owned records from all indexed definition kinds without body decoding', () => {
  const inspector = new AssemblyInspector(assemblyFixture());
  const index = new AssemblySymbolIndex([inspector]);
  const all = index.search('').entries;
  assert.deepEqual([...new Set(all.map(entry => entry.kind))].sort(), ['event', 'field', 'method', 'property', 'type']);
  const expected = index.search('M0').entries[0];
  index.search('M0').entries[0].name = 'changed return';
  inspector.methods.get(expected.token).name = 'changed input';
  inspector.pe.bytes.fill(0);
  assert.deepEqual(index.search('M0').entries[0], expected);
  assert.deepEqual(index.get(expected.id), expected);
  assert.equal(inspector.cache.size, 0);
  const storage = index.searchStorage;
  index.searchStorage.bytes = 0;
  assert.deepEqual(index.searchStorage, storage);
});

test('search cache has an independent exact budget and is lazy for zero pages and empty queries', () => {
  const index = make(20);
  assert.equal(index.search('', { cacheBytes: 0, resultLimit: 3 }).entries.length, 3);
  assert.equal(index.search('Search', { limit: 0, cacheBytes: 0 }).entries.length, 0);
  assert.deepEqual(index.searchStorage, { entries: 0, bytes: 0 });
  assert.throws(() => index.search('Search', { cacheBytes: 0 }), /cache budget/);
  assert.deepEqual(index.searchStorage, { entries: 0, bytes: 0 });
  index.search('Search');
  const bytes = index.searchStorage.bytes;
  assert.equal(make(20).search('Search', { cacheBytes: bytes }).entries.length, 20);
  const failed = make(20);
  assert.throws(() => failed.search('Search', { cacheBytes: bytes - 1 }), /cache budget/);
  assert.deepEqual(failed.searchStorage, { entries: 0, bytes: 0 });
  assert.throws(() => index.search('Search', { cacheBytes: bytes - 1 }), /cache budget/);
  assert.equal(index.search('Search', { cacheBytes: bytes }).entries.length, 20);
});

test('ASCII length preflight preserves exact cache accounting and mixed Unicode initial semantics', () => {
  const cases = [['XMLReader', 'xmlr'], ['foo_bar', 'fb'], ['Alpha99Beta2', 'a9b2'], ['a.b+c/d', 'abcd'],
    ['a$b-c', 'abc'], ['a\u007fB', 'ab'], ['a\u0080B', 'ab'], ['İstanbulIndex', 'i\u0307i'], ['AΣ', 'aς'],
    ['\u{10400}Name', '\u{10428}n'], ['x\u0301Name', 'xn'], ['中文_类型', '中类']];
  const records = [['<Module>', 'm'], ...cases.map(([name, humps]) => ['Fixtures.' + name, 'f' + humps])];
  const bytes = records.reduce((total, [name, humps]) => total + 2 * (1 + name.toLowerCase().length + humps.length), 0);
  const source = cases.map(([name]) => name);
  const index = make(source);
  index.search('absent', { cacheBytes: bytes });
  assert.deepEqual(index.searchStorage, { entries: records.length, bytes });
  for (const [name, humps] of cases) assert.ok(names(index.search('f' + humps, { mode: 'camel' })).includes('Fixtures.' + name));
  const rejected = make(source);
  assert.throws(() => rejected.search('absent', { cacheBytes: bytes - 1 }), /cache budget/);
  assert.deepEqual(rejected.searchStorage, { entries: 0, bytes: 0 });
});

test('search checks query/options/page boundaries and reports only actual continuation or cap overflow', () => {
  const index = make(['Alpha', 'AlphaBeta', 'Beta']);
  for (const query of [null, 1, {}, 'x'.repeat(257)]) assert.throws(() => index.search(query), CilError);
  for (const options of [null, [], { mode: 'regex' }, { offset: -1 }, { offset: 11, resultLimit: 10 },
    { limit: 1001 }, { limit: NaN }, { resultLimit: 0 }, { resultLimit: 10001 }, { cacheBytes: -1 },
    { cacheBytes: 64 * 1024 * 1024 + 1 }, { offset: 0.5 }]) assert.throws(() => index.search('a', options), CilError);
  assert.deepEqual(index.search('Alpha', { mode: 'prefix', limit: 0 }), { entries: [], nextOffset: null, capped: false });
  const exact = index.search('Alpha', { mode: 'prefix', resultLimit: 2 });
  assert.equal(exact.entries.length, 2);
  assert.equal(exact.capped, false);
  assert.equal(exact.nextOffset, null);
  assert.equal(index.search('Alpha', { mode: 'prefix', resultLimit: 1 }).capped, true);
  assert.deepEqual(index.search('Alpha', { mode: 'prefix', offset: 2 }), { entries: [], nextOffset: null, capped: false });
  assert.deepEqual(new AssemblySymbolIndex([]).search(''), { entries: [], nextOffset: null, capped: false });
});

test('cancelled search preflight/build publishes no partial cache and cached scans remain cancellable', () => {
  const index = make(1024);
  assert.throws(() => index.search('Search', { signal: AbortSignal.abort() }), /cancelled/);
  let reads = 0;
  assert.throws(() => index.search('Search', { signal: { get aborted() { return ++reads > 8; } } }), /cancelled/);
  assert.deepEqual(index.searchStorage, { entries: 0, bytes: 0 });
  assert.equal(index.search('Search').entries.length, 100);
  assert.equal(index.searchStorage.entries, 1025);
  reads = 0;
  assert.throws(() => index.search('missing', { signal: { get aborted() { return ++reads > 2; } } }), /cancelled/);
  assert.equal(index.search('Search').entries.length, 100);
});

test('search preserves retained native method identities and reload results', () => {
  const base = new URL('./fixtures/portable-pdb-unnamed-slots/', import.meta.url);
  const bytes = readFileSync(new URL('UnnamedSlots.dll', base));
  const reference = JSON.parse(readFileSync(new URL('reference.json', base), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.reference.assemblySha256);
  const inspector = new AssemblyInspector(bytes), index = new AssemblySymbolIndex([inspector]);
  const reload = new AssemblySymbolIndex([new AssemblyInspector(bytes)]);
  for (const method of reference.native.methods) {
    const actual = index.search(method.name, { mode: 'prefix' });
    assert.ok(actual.entries.some(entry => entry.id === inspector.tokenUri(method.token) && entry.name === method.name));
    assert.deepEqual(actual, reload.search(method.name, { mode: 'prefix' }));
  }
  assert.equal(inspector.cache.size, 0);
});
