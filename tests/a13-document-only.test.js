import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { emitPortablePdb, readPortablePdb, PdbGuids, sha256, SymbolError } from '@sharpforge/symbols';

const assembly = compileToIL('Console.WriteLine(1);', { portablePdb: false }).assembly;
const write = sources => readPortablePdb(emitPortablePdb(assembly, { sources }).bytes);

test('mapped documents with unavailable content have no invented checksum or embedded source', () => {
  const pdb = write([{ uri: 'view.razor', documentOnly: true }]);
  assert.equal(pdb.documents[0].name, 'view.razor');
  assert.equal(pdb.documents[0].hashAlgorithm, null);
  assert.equal(pdb.documents[0].hash.length, 0);
  assert.equal(pdb.documents[0].language, PdbGuids.csharp);
  assert.equal(pdb.custom.some(record => record.kind === PdbGuids.embeddedSource), false);
});

test('mapped document checksums preserve the producer declaration without hashing absent content', () => {
  const hashAlgorithm = '12345678-1234-1234-1234-123456789abc';
  const hash = Uint8Array.of(1, 2, 3, 4);
  const pdb = write([{ uri: 'mapped.cs', documentOnly: true, hashAlgorithm, hash }]);
  assert.equal(pdb.documents[0].hashAlgorithm, hashAlgorithm);
  assert.deepEqual(pdb.documents[0].hash, hash);
  assert.equal(pdb.custom.length, 0);
});

test('mapped document checksum boundaries retain explicit empty and maximum-size declarations', () => {
  for (const size of [0, 4096]) {
    const hash = new Uint8Array(size);
    const pdb = write([{ uri: 'mapped.cs', documentOnly: true, hashAlgorithm: PdbGuids.sha256, hash }]);
    assert.deepEqual(pdb.documents[0].hash, hash);
  }
});

test('ordinary content keeps exact checksum validation and source embedding', () => {
  const text = '\uFEFFclass C {}\r\n';
  const bytes = new TextEncoder().encode(text);
  const hash = sha256(bytes);
  const pdb = write([{ uri: 'source.cs', text, hash }]);
  assert.deepEqual(pdb.documents[0].hash, hash);
  assert.equal(pdb.custom.filter(record => record.kind === PdbGuids.embeddedSource).length, 1);
  assert.throws(() => write([{ uri: 'source.cs', text, hash: new Uint8Array(32) }]), /checksum does not match/);
});

test('document-only mode rejects ambiguous content and malformed checksum records', () => {
  const base = { uri: 'mapped.cs', documentOnly: true };
  for (const fields of [
    { text: '' },
    { bytes: new Uint8Array() },
    { hash: new Uint8Array() },
    { hashAlgorithm: PdbGuids.sha256 },
    { hashAlgorithm: PdbGuids.sha256, hash: [] },
    { hashAlgorithm: null, hash: new Uint8Array() },
    { hashAlgorithm: '', hash: new Uint8Array() },
    { hashAlgorithm: 0, hash: new Uint8Array() },
    { hashAlgorithm: 'invalid', hash: new Uint8Array() },
    { hashAlgorithm: PdbGuids.sha256, hash: new Uint8Array(4097) },
  ]) assert.throws(() => write([{ ...base, ...fields }]), SymbolError);
});

test('document-only and content-backed documents preserve ordering and duplicate-name rejection', () => {
  const pdb = write([{ uri: 'physical.cs', text: 'x' }, { uri: 'mapped.cs', documentOnly: true }]);
  assert.deepEqual(pdb.documents.map(document => document.name), ['physical.cs', 'mapped.cs']);
  assert.throws(() => write([{ uri: 'x', text: '' }, { uri: 'x', documentOnly: true }]), /Duplicate document/);
});
