import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { createSymbolServer, readPortablePdb, SourceStatus } from '@sharpforge/symbols';

const compiled = compileToIL('Console.WriteLine(42);');
assert(compiled.success);
const identity = readPortablePdb(compiled.pdb).id;
const service = (options = {}) =>
  createSymbolServer({
    serverUrl: 'https://symbols.example',
    allowedOrigins: ['https://symbols.example'],
    requestPermission: () => true,
    fetch: async () => new Response(compiled.pdb),
    ...options,
  });

for (const shape of ['uint8array', 'arraybuffer', 'buffer']) {
  test(`both public PDB lookups snapshot ${shape} assemblies before requesting permission`, async () => {
    for (const derived of [false, true]) {
      const bytes = shape === 'buffer' ? Buffer.from(compiled.assembly) : new Uint8Array(compiled.assembly);
      const assembly = shape === 'arraybuffer' ? bytes.buffer : bytes;
      const id = new Uint8Array(identity);
      let permissions = 0;
      const client = service({
        requestPermission() {
          permissions++;
          bytes.fill(0);
          id.fill(0);
          return true;
        },
      });
      const result = await (derived
        ? client.lookupForAssembly(assembly)
        : client.lookupPortablePdb('Application.pdb', id, { assembly }));
      assert.equal(permissions, 1);
      assert.equal(result.status, SourceStatus.verified);
      assert.equal(result.symbols.bound, true);
      assert.equal(result.checksumVerified, true);
      assert.deepEqual(result.symbols.id, identity);
      assert.deepEqual(result.bytes, compiled.pdb);
      client.dispose();
    }
  });
}

test('both public assembly boundaries reject invalid or oversized inputs before permission', async () => {
  let permissions = 0;
  const client = service({
    maxBytes: compiled.assembly.length - 1,
    requestPermission() {
      permissions++;
      return true;
    },
  });
  for (const assembly of [compiled.assembly, compiled.assembly.buffer, 'invalid', new DataView(new ArrayBuffer(8))]) {
    assert.equal((await client.lookupForAssembly(assembly)).status, SourceStatus.invalidIdentity);
    assert.equal(
      (await client.lookupPortablePdb('Application.pdb', identity, { assembly })).status,
      SourceStatus.invalidIdentity,
    );
  }
  assert.equal(permissions, 0);
  client.dispose();
});

test('concurrent lookups retain independent snapshots and preserve caller inputs', async () => {
  const original = new Uint8Array(compiled.assembly);
  const input = new Uint8Array(original);
  const client = service();
  const pending = client.lookupForAssembly(input);
  assert.deepEqual(input, original);
  input.fill(0);
  const [valid, invalid] = await Promise.all([pending, client.lookupForAssembly(input)]);
  assert.equal(valid.status, SourceStatus.verified);
  assert.equal(invalid.status, SourceStatus.invalidIdentity);
  assert.deepEqual(original, compiled.assembly);
  client.dispose();
});
