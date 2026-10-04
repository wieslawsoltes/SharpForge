import { AssemblyInspector, AssemblySymbolIndex, CilError } from '@sharpforge/cil';
import { typeFixture } from './fixture.mjs';
import { queries, checkResult } from './queries.mjs';

function assert(value, message) {
  if (!value) throw Error(message);
}

function rejects(action, pattern) {
  try { action(); } catch (error) {
    assert(error instanceof CilError && pattern.test(error.message), `Unexpected ${error.name}: ${error.message}`);
    return;
  }
  throw Error('Expected CilError: ' + pattern);
}

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export async function run() {
  const report = { passed: false, checks: [], chronologicalSamples: [],
    protocol: { rounds: 3, warmups: 0, iterationsPerCell: 1, thresholdMs: 50,
      order: 'six cases forward/reverse on alternating rounds; fresh index per cold/warm pair',
      scope: 'Index already constructed; cold query includes all lazy cache work, warm immediately follows.' } };
  try {
    const image = typeFixture();
    const large = new AssemblyInspector(image);
    report.authoredFixtureSha256 = hex(await crypto.subtle.digest('SHA-256', image));
    const start = performance.now();
    for (let round = 0; round < 3; round++) for (const item of round % 2 ? [...queries].reverse() : queries) {
      const index = new AssemblySymbolIndex([large]);
      assert(index.size === 50001 && index.searchStorage.entries === 0, 'Cold index state');
      for (const state of ['cold', 'warm']) {
        const sampleStart = performance.now();
        const result = index.search(item.query, { mode: item.mode, offset: item.offset ?? 0, limit: 37 });
        const elapsedMs = performance.now() - sampleStart;
        report.chronologicalSamples.push({ name: item.name, round, state, elapsedMs, startOffsetMs: sampleStart - start,
          resultCount: result.entries.length, logicalCache: index.searchStorage });
        checkResult(result, item);
      }
    }
    assert(large.cache.size === 0, 'Search decoded methods');
    report.checks.push('50k authored types: late/miss queries in all three modes, cold/warm fixed samples and page caps');
    const index = new AssemblySymbolIndex([large]);
    index.search('Search');
    const storage = index.searchStorage;
    rejects(() => index.search('Search', { cacheBytes: storage.bytes - 1 }), /cache budget/);
    rejects(() => new AssemblySymbolIndex([large]).search('Search', { cacheBytes: 0 }), /cache budget/);
    rejects(() => index.search('Search', { signal: AbortSignal.abort() }), /cancelled/);
    rejects(() => index.search('Search', { limit: 1001 }), /page limit/);
    const capped = index.search('Search', { resultLimit: 2 });
    assert(capped.entries.length === 2 && capped.capped && capped.nextOffset === null, 'Total result cap');
    assert(index.search('Search', { limit: 0 }).nextOffset === null, 'Zero page');
    const owned = index.search('SearchType49999').entries[0];
    const expected = index.get(owned.id);
    owned.name = 'changed';
    large.pe.bytes.fill(0);
    index.searchStorage.bytes = 0;
    assert(JSON.stringify(index.search('SearchType49999').entries[0]) === JSON.stringify(expected), 'Borrowed result/input');
    assert(index.searchStorage.bytes === storage.bytes, 'Borrowed storage counters');
    report.checks.push('Independent cache cap, cancellation, bounded result totals, zero pages and owned state');
    const unicode = new AssemblySymbolIndex([new AssemblyInspector(typeFixture(['NullReferenceException', 'XMLReader',
      'ÉclairFactory', '中文_类型', '\u{10400}Name', 'école']))]);
    for (const [query, name] of [['nre', 'NullReferenceException'], ['xr', 'XMLReader'], ['éf', 'ÉclairFactory'],
      ['中类', '中文_类型'], ['\u{10428}n', '\u{10400}Name']])
      assert(unicode.search(query, { mode: 'camel' }).entries.some(entry => entry.name === 'Fixtures.' + name), 'Unicode initials');
    assert(unicode.search('ÉCO', { mode: 'prefix' }).entries[0].name === 'Fixtures.école', 'Unicode prefix');
    assert(unicode.search('e\u0301co').entries.length === 0 && unicode.search('.*').entries.length === 0, 'Literal/no NFC');
    assert(unicode.search('', { cacheBytes: 0 }).entries.length === unicode.size, 'Empty query uses no cache');
    report.checks.push('Unicode/literal/initial semantics and empty query');
    const base = '/tests/fixtures/portable-pdb-unnamed-slots/';
    const response = await fetch(base + 'UnnamedSlots.dll');
    if (!response.ok) throw Error('Native fixture unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const reference = await (await fetch(base + 'reference.json')).json();
    assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === reference.reference.assemblySha256, 'Native PE hash');
    const inspector = new AssemblyInspector(bytes), native = new AssemblySymbolIndex([inspector]);
    const reload = new AssemblySymbolIndex([new AssemblyInspector(bytes)]);
    for (const method of reference.native.methods) {
      const result = native.search(method.name, { mode: 'prefix' });
      assert(result.entries.some(entry => entry.name === method.name && entry.id === inspector.tokenUri(method.token)), 'Native identity');
      assert(JSON.stringify(result) === JSON.stringify(reload.search(method.name, { mode: 'prefix' })), 'Native reload');
    }
    assert(inspector.cache.size === 0, 'Native body decode');
    report.reference = reference.reference;
    report.checks.push('Retained native PE SHA-256, method identities and reload results');
    report.thresholdFailures = report.chronologicalSamples.filter(sample => sample.elapsedMs > 50);
    report.passed = report.thresholdFailures.length === 0;
  } catch (error) {
    report.error = { name: error.name, message: error.message };
  }
  return report;
}
