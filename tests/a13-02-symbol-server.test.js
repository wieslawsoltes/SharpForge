import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToIL } from '@sharpforge/compiler';
import { readPE } from '@sharpforge/cil';
import {
  portablePdbKey,
  peSymbolKey,
  createSymbolServer,
  readPortablePdb,
  guidBytes,
  SourceStatus,
  SymbolError,
} from '@sharpforge/symbols';

const compiled = compileToIL('Console.WriteLine(42);');
assert(compiled.success);
const pdb = readPortablePdb(compiled.pdb);
const pe = readPE(compiled.assembly, { inspection: true });
const service = (options = {}) =>
  createSymbolServer({
    serverUrl: 'https://symbols.example/store',
    allowedOrigins: ['https://symbols.example'],
    requestPermission: () => true,
    fetch: async () => new Response(compiled.pdb),
    ...options,
  });

test('SSQP specification examples use lowercase filenames, mixed-endian GUIDs and required hex casing', () => {
  const id = new Uint8Array(20);
  id.set(guidBytes('497b72f6-390a-44fc-878e-5a2d63b6cc4b'));
  assert.equal(portablePdbKey('C:\\build\\Foo.PDB', id), 'foo.pdb/497b72f6390a44fc878e5a2d63b6cc4bFFFFFFFF/foo.pdb');
  id[19] = 255;
  assert.equal(portablePdbKey('/tmp/Foo.PDB', id), portablePdbKey('Foo.PDB', id));
  assert.equal(
    peSymbolKey('Foo.exe', { timestamp: 0x542d574e, sizeOfImage: 0xc2000 }),
    'foo.exe/542D574Ec2000/foo.exe',
  );
  assert.equal(peSymbolKey('Foo.exe', { timestamp: 0, sizeOfImage: 1 }), 'foo.exe/000000001/foo.exe');
  assert.equal(
    peSymbolKey('Foo.exe', { timestamp: 0xffffffff, sizeOfImage: 0xffffffff }),
    'foo.exe/FFFFFFFFffffffff/foo.exe',
  );
  assert.match(portablePdbKey('ΟΣ.PDB', id), /^οσ\.pdb\//);
});

test('key validation rejects malformed identities, unsafe file names and over-budget paths', () => {
  for (const name of ['', '.', '..', 'C:\\dir\\', 'a\0.pdb', '\ud800.pdb', 'a'.repeat(1025)]) {
    assert.throws(() => portablePdbKey(name, pdb.id), SymbolError);
  }
  assert.throws(() => portablePdbKey('a.pdb', pdb.id.subarray(0, 19)), SymbolError);
  assert.throws(() => portablePdbKey('a'.repeat(32769), pdb.id), SymbolError);
  for (const identity of [
    null,
    {},
    { timestamp: -1, sizeOfImage: 1 },
    { timestamp: 1, sizeOfImage: 0 },
    { timestamp: 0x100000000, sizeOfImage: 1 },
    { timestamp: 1.5, sizeOfImage: 1 },
  ]) {
    assert.throws(() => peSymbolKey('a.dll', identity), SymbolError);
  }
});

test('symbol lookups require permission and preserve the server prefix and escaped filename', async () => {
  let count = 0;
  const denied = service({
    requestPermission: () => false,
    fetch() {
      count++;
    },
  });
  assert.equal((await denied.lookupPortablePdb('A.pdb', pdb.id)).status, SourceStatus.denied);
  assert.equal(count, 0);
  const requests = [];
  const client = service({
    requestPermission: (request) => {
      assert.equal(request.purpose, 'symbol-server');
      return true;
    },
    fetch: async (url, options) => {
      requests.push(url);
      assert.equal(options.credentials, 'omit');
      return new Response(compiled.pdb);
    },
  });
  const result = await client.lookupPortablePdb("A B!'%.PDB", pdb.id);
  assert.equal(result.status, SourceStatus.verified);
  assert.equal(result.identityVerified, true);
  assert.equal(result.checksumVerified, false);
  assert.equal(result.text, null);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /^https:\/\/symbols\.example\/store\/a%20b%21%27%25\.pdb\//);
});

test('assembly-derived lookup validates Portable PDB identity, checksum, rows and sequence points', async () => {
  const result = await service().lookupForAssembly(Buffer.from(compiled.assembly));
  assert.equal(result.status, SourceStatus.verified);
  assert.equal(result.kind, 'portable-pdb');
  assert.equal(result.symbols.bound, true);
  assert.equal(result.checksumVerified, true);
  assert.deepEqual(result.bytes, compiled.pdb);
  const tampered = new Uint8Array(compiled.pdb);
  tampered[tampered.length - 1] ^= 1;
  const bad = await service({ fetch: async () => new Response(tampered) }).lookupForAssembly(compiled.assembly);
  assert.equal(bad.status, SourceStatus.invalidIdentity);
  assert.equal(bad.bytes, null);
});

test('full PDB identity is checked even when the SSQP GUID key is unchanged', async () => {
  const id = new Uint8Array(pdb.id);
  id[19] ^= 1;
  assert.equal(portablePdbKey('a.pdb', id), portablePdbKey('a.pdb', pdb.id));
  const result = await service().lookupPortablePdb('a.pdb', id);
  assert.equal(result.status, SourceStatus.invalidIdentity);
  assert.equal(result.bytes, null);
  assert.equal(result.text, null);
});

test('PE lookup verifies timestamp and image size without executing the downloaded image', async () => {
  const client = service({ fetch: async () => new Response(compiled.assembly) });
  const result = await client.lookupPE('Application.dll', pe);
  assert.equal(result.status, SourceStatus.verified);
  assert.equal(result.kind, 'pe');
  assert.equal(result.checksumVerified, false);
  assert.equal(result.pe.timestamp, pe.timestamp);
  assert.equal(
    (await client.lookupPE('Application.dll', { ...pe, timestamp: pe.timestamp ^ 1 })).status,
    SourceStatus.invalidIdentity,
  );
  assert.equal(
    (await client.lookupPE('Application.dll', { ...pe, sizeOfImage: pe.sizeOfImage + 1 })).status,
    SourceStatus.invalidIdentity,
  );
});

test('malformed payloads, input types and source limits return explicit unverified results', async () => {
  assert.equal(
    (await service({ fetch: async () => new Response('invalid') }).lookupPortablePdb('a.pdb', pdb.id)).status,
    SourceStatus.invalidIdentity,
  );
  assert.equal(
    (await service({ maxBytes: compiled.pdb.length - 1 }).lookupPortablePdb('a.pdb', pdb.id)).status,
    SourceStatus.tooLarge,
  );
  assert.equal((await service().lookupForAssembly(0xffffffff)).status, SourceStatus.invalidIdentity);
  assert.equal((await service().lookupPortablePdb('a.pdb', new Uint8Array(19))).status, SourceStatus.invalidIdentity);
  assert.equal((await service().lookupPE('a.dll', null)).status, SourceStatus.invalidIdentity);
});

test('symbol-client disposal and cancellation reuse the permission transport lifetime', async () => {
  const client = service({ requestPermission: () => new Promise(() => {}) });
  const pending = client.lookupPortablePdb('a.pdb', pdb.id);
  client.dispose();
  assert.equal((await pending).status, SourceStatus.disposed);
  assert.equal((await client.lookupPE('a.dll', pe)).status, SourceStatus.disposed);
  assert.equal(
    (await service().lookupPortablePdb('a.pdb', pdb.id, { signal: AbortSignal.abort() })).status,
    SourceStatus.cancelled,
  );
  for (const serverUrl of [
    'http://symbols.example',
    'https://user:secret@symbols.example',
    'https://symbols.example/?q=x',
  ]) {
    assert.throws(() => service({ serverUrl }), SymbolError);
  }
});

test('SSQP keys match captured dotnet-symbol 8.0.532401 requests', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/symbol-server/keys.json', import.meta.url), 'utf8'));
  assert.equal(fixture.reference.version, '8.0.532401');
  assert.match(fixture.reference.toolSha256, /^[a-f0-9]{64}$/);
  for (const entry of fixture.cases) {
    if (entry.kind === 'portable-pdb') assert.equal(portablePdbKey(entry.name, Uint8Array.from(entry.id)), entry.key);
    else assert.equal(peSymbolKey(entry.name, entry), entry.key);
  }
});
