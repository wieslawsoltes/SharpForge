import { AssemblyInspector, AssemblySymbolIndex, CilError } from '@sharpforge/cil';
import { assemblyFixture } from './fixture.mjs';

function assert(value, label) {
  if (!value) throw Error(label);
}

function rejects(action, pattern) {
  try {
    action();
  } catch (error) {
    assert(error instanceof CilError && pattern.test(error.message), `Unexpected ${error.name}: ${error.message}`);
    return;
  }
  throw Error('Expected CilError: ' + pattern);
}

const hex = bytes => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export async function run() {
  const checks = [];
  const images = Array.from({ length: 20 }, (_, index) => assemblyFixture(index + 1, 1000));
  const loaded = images.map(bytes => new AssemblyInspector(bytes));
  const index = new AssemblySymbolIndex(loaded, { assemblies: 20, entries: 20120, nameBytes: 256000, bytes: 6000000 });
  const reload = new AssemblySymbolIndex(images.map(bytes => new AssemblyInspector(bytes)));
  assert(index.size === 20120 && index.modules().length === 20, 'Twenty-module definition counts');
  assert(index.storage.nameBytes <= 256000 && index.storage.bytes <= 6000000, 'Logical storage caps');
  for (let offset = 0; offset < index.size; offset += 1000) {
    const page = index.page({ offset, limit: 1000 });
    assert(JSON.stringify(page) === JSON.stringify(reload.page({ offset, limit: 1000 })), 'Stable reload IDs and facts');
    for (const entry of page.entries) assert(JSON.stringify(entry) === JSON.stringify(index.get(entry.id)), 'Indexed lookup');
  }
  assert(loaded.every(inspector => inspector.cache.size === 0), 'Unexpected method decoding');
  checks.push('20 modules/20,120 definitions, bounded logical storage, stable reload IDs and no body decode');

  const owned = index.page({ limit: 10 });
  const entry = owned.entries.find(record => record.kind === 'method');
  const snapshot = index.get(entry.id);
  entry.name = 'changed output';
  loaded[0].methods.get(snapshot.token).name = 'changed input';
  loaded[0].pe.bytes.fill(0);
  index.modules()[0].mvid = 'changed module';
  index.storage.entries = 0;
  assert(JSON.stringify(index.get(snapshot.id)) === JSON.stringify(snapshot), 'Borrowed record or PE');
  assert(index.modules()[0].mvid !== 'changed module' && index.storage.entries === index.size, 'Borrowed counters');
  checks.push('Owned scalar records survive input metadata and output mutation');

  const pointer = new AssemblyInspector(assemblyFixture(21, 3, [3, 1, 2]));
  const small = new AssemblySymbolIndex([pointer]);
  const all = small.page().entries;
  assert([...new Set(all.map(record => record.kind))].sort().join() === 'event,field,method,property,type', 'Definition kinds');
  assert(all.filter(record => record.kind === 'method').map(record => record.token).join() === '100663299,100663297,100663298',
    'MethodPtr ownership order');
  assert(small.page({ limit: 0 }).nextOffset === null && small.page({ offset: small.size }).entries.length === 0, 'Empty/end pages');
  assert(small.get('unknown') === null && new AssemblySymbolIndex([]).size === 0, 'Missing/empty index');
  checks.push('Five definition kinds, MethodPtr ownership and empty/end pages');

  const usage = small.storage;
  for (const key of ['assemblies', 'entries', 'nameBytes', 'bytes'])
    rejects(() => new AssemblySymbolIndex([pointer], { [key]: usage[key] - 1 }), /limit/);
  rejects(() => new AssemblySymbolIndex([pointer, pointer]), /Duplicate module/);
  rejects(() => small.page({ limit: 1001 }), /page limit/);
  rejects(() => small.page({ signal: AbortSignal.abort() }), /cancelled/);
  rejects(() => new AssemblySymbolIndex([pointer], { signal: AbortSignal.abort() }), /cancelled/);
  checks.push('Count/payload boundaries, duplicate MVIDs, page limits and cancellation');

  const base = '/tests/fixtures/portable-pdb-unnamed-slots/';
  const response = await fetch(base + 'UnnamedSlots.dll');
  if (!response.ok) throw Error('Native fixture unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const reference = await (await fetch(base + 'reference.json')).json();
  assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === reference.reference.assemblySha256, 'Native PE SHA-256');
  const native = new AssemblyInspector(bytes);
  const nativeIndex = new AssemblySymbolIndex([native]);
  for (const expected of reference.native.methods) {
    const actual = nativeIndex.get(native.tokenUri(expected.token));
    assert(actual?.name === expected.name && actual.token === expected.token && actual.kind === 'method', 'Native method facts');
  }
  assert(native.cache.size === 0, 'Native method decoded');
  checks.push('Retained Roslyn/CoreCLR PE hash and method-token/name reference');
  return { passed: true, checks, reference: reference.reference };
}
