import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, assemblyReferenceIdentity, readMetadata, CilError } from '@sharpforge/cil';

function emittedIdentity(builder, name) {
  const token = builder.assemblyRef(name);
  const metadata = readMetadata(builder.finish());
  const row = metadata.row(token);
  return { name: metadata.string(row[6]), version: row.slice(0, 4), culture: metadata.string(row[7]),
    flags: row[4], publicKeyOrToken: new Uint8Array(metadata.blob(row[5])) };
}

test('A03-T22 assembly reference identities agree with emitted rows for every fallback profile', () => {
  for (const [framework, name, version] of [['net8', 'System.Runtime', [8, 0, 0, 0]],
    ['mscorlib4', 'mscorlib', [4, 0, 0, 0]], ['net10', 'SharpForge.Runtime', [0, 10, 0, 0]]]) {
    const builder = new MetadataBuilder('Identity', { framework });
    const identity = assemblyReferenceIdentity(builder, name);
    assert.deepEqual(identity.version, version);
    assert.equal(builder.rows[35], undefined, 'identity inspection adds no row');
    assert.deepEqual(identity, emittedIdentity(builder, name));
    assert.equal(builder.assemblyRef(name.toUpperCase()), 0x23000001, 'ordinary emission keeps its interning contract');
  }
});

test('A03-T22 configured identities are canonical and defensively owned', () => {
  const version = [10, 2, 3, 4];
  const key = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);
  const builder = new MetadataBuilder('Identity', { framework: 'net10', assemblyReferences: [
    { name: 'Contract', version, culture: 'pl-PL', flags: 0x100, publicKeyOrToken: key },
  ] });
  version[0] = 99;
  key[0] = 99;
  const first = assemblyReferenceIdentity(builder, 'contract');
  assert.deepEqual(first, { name: 'Contract', version: [10, 2, 3, 4], culture: 'pl-PL', flags: 0x100,
    publicKeyOrToken: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8) });
  first.version[1] = 99;
  first.publicKeyOrToken[1] = 99;
  const second = assemblyReferenceIdentity(builder, 'CONTRACT');
  assert.notEqual(second.version, first.version);
  assert.notEqual(second.publicKeyOrToken, first.publicKeyOrToken);
  assert.deepEqual(second, emittedIdentity(builder, 'contract'));
});

test('A03-T22 full public keys preserve their flags and helper results never alias the registry', () => {
  const key = new Uint8Array(32).fill(17);
  const builder = new MetadataBuilder('Identity', { assemblyReferences: [
    { name: 'FullKey', version: [1, 0, 0, 0], flags: 1, publicKeyOrToken: key },
  ] });
  const first = assemblyReferenceIdentity(builder, 'FullKey');
  assert.equal(first.flags, 1);
  assert.deepEqual(first.publicKeyOrToken, key);
  first.publicKeyOrToken.fill(0);
  assert.deepEqual(assemblyReferenceIdentity(builder, 'FullKey'), emittedIdentity(builder, 'FullKey'));
});

test('A03-T22 identity lookup rejects the same invalid names and missing framework inputs as emission', () => {
  const builder = new MetadataBuilder('Identity');
  for (const name of [undefined, null, '', 'x'.repeat(513)]) {
    assert.throws(() => assemblyReferenceIdentity(builder, name), CilError);
    assert.throws(() => builder.assemblyRef(name), CilError);
  }
  for (const framework of ['net9', 'net10']) {
    const strict = new MetadataBuilder('Identity', { framework });
    assert.throws(() => assemblyReferenceIdentity(strict, 'System.Runtime'), /Missing input assembly reference identity/);
    assert.throws(() => strict.assemblyRef('System.Runtime'), /Missing input assembly reference identity/);
    assert.equal(strict.rows[35], undefined);
  }
});
