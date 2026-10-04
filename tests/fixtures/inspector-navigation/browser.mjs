import { AssemblyInspector, CilError } from '@sharpforge/cil';
import { fixture } from './fixture.mjs';
const assert = (condition, label) => {
  if (!condition) throw Error(label);
};
function rejects(action, pattern) {
  try {
    action();
  } catch (error) {
    assert(error instanceof CilError && pattern.test(error.message), `Unexpected ${error.name}: ${error.message}`);
    return;
  }
  throw Error('Expected CilError: ' + pattern);
}
const hex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function run() {
  const checks = [];
  const large = new AssemblyInspector(fixture(20000).bytes);
  assert(large.cache.size === 0, 'Construction decoded methods');
  const page = large.summary({ methodOffset: 19997, methodLimit: 2 });
  assert(page.methods.length === 2 && large.cache.size === 2, 'Unrequested method decoding');
  assert(
    page.methods[0].token === 0x06000000 + 19998 && page.methodPage.nextOffset === 19999,
    'Physical page identity',
  );
  page.methods[0].instructions[0].name = 'changed';
  assert(
    large.summary({ methodOffset: 19997, methodLimit: 1 }).methods[0].instructions[0].name === 'ret',
    'Borrowed method result',
  );
  checks.push('20k methods: exact requested decode count and owned nested results');
  const input = fixture(4, [3, 1, 4, 2]),
    inspector = new AssemblyInspector(input.bytes);
  assert(
    inspector
      .summary({ includeMethods: false })
      .methods.map((method) => method.name)
      .join() === 'M2,M0,M3,M1',
    'Legacy owner order',
  );
  assert(
    inspector
      .summary({ methodOffset: 1, methodLimit: 2, includeMethods: false })
      .methods.map((method) => method.name)
      .join() === 'M1,M2',
    'Physical page order',
  );
  assert(inspector.summary({ methodOffset: 4, methodLimit: 1 }).methods.length === 0, 'Exact end page');
  assert(
    inspector.summary({ methodLimit: 0 }).methods.length === 0 && inspector.cache.size === 0,
    'Empty page decoding',
  );
  checks.push('MethodPtr, definition-only, zero and end boundaries');
  for (const options of [{ methodOffset: -1 }, { methodOffset: 5 }, { methodLimit: 1001 }, { methodLimit: NaN }])
    rejects(() => inspector.summary(options), /page/);
  rejects(() => inspector.summary({ methodLimit: 2, maxPageCodeBytes: 1 }), /code budget/);
  rejects(() => inspector.summary({ methodLimit: 1, signal: AbortSignal.abort() }), /cancelled/);
  assert(inspector.cache.size === 0, 'Guard must precede any method decode');
  assert(inspector.summary({ methodLimit: 2, maxPageCodeBytes: 2 }).methods.length === 2, 'Code budget boundary');
  checks.push('page validation, aggregate alias-body accounting and cancellation');
  const reload = new AssemblyInspector(input.bytes);
  for (const [table, rows] of Object.entries(inspector.metadata.rows))
    for (let index = 0; index < rows.length; index++) {
      const token = Number(table) * 0x1000000 + index + 1;
      assert(reload.resolveUri(inspector.tokenUri(token)).token === token, 'Reload row token');
    }
  assert(reload.resolveUri(inspector.tokenUri(input.userString)).token === input.userString, 'Reload user string');
  const uri = inspector.tokenUri(0x06000001);
  assert(uri === 'sf-metadata://04030201-0605-0807-090a-0b0c0d0e0f10/0x06000001', 'Mixed endian MVID');
  for (const token of [0, -1, NaN, 0x106000001, 0x06000005, 0x70ffffff]) rejects(() => inspector.tokenUri(token), /./);
  rejects(() => reload.resolveUri(uri.replace('04030201', 'ffffffff')), /different module/);
  rejects(() => reload.resolveUri(uri + '#x'), /Invalid metadata URI/);
  assert(reload.cache.size === 0, 'URI resolution decoded bodies');
  checks.push('all row/user-string URI reloads, MVID spelling and malformed identities');
  const base = '/tests/fixtures/portable-pdb-unnamed-slots/';
  const response = await fetch(base + 'UnnamedSlots.dll');
  if (!response.ok) throw Error('Native PE fixture unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const reference = await (await fetch(base + 'reference.json')).json();
  assert(hex(await crypto.subtle.digest('SHA-256', bytes)) === reference.reference.assemblySha256, 'Native PE hash');
  const native = new AssemblyInspector(bytes),
    nativeReload = new AssemblyInspector(bytes);
  for (const method of reference.native.methods)
    assert(nativeReload.resolveUri(native.tokenUri(method.token)).token === method.token, 'Native MethodDef identity');
  assert(nativeReload.cache.size === 0, 'Native reload decoded methods');
  const first = nativeReload.summary({ methodLimit: 1 });
  assert(first.methods.length === 1 && nativeReload.cache.size === 1, 'Native first page');
  checks.push('retained Roslyn/CoreCLR PE hash and native method identity');
  return { passed: true, checks, reference: reference.reference };
}
