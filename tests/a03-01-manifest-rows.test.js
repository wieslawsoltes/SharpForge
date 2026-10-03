import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, decodeCoded, Tables } from '@sharpforge/cil';

test('A03 manifest APIs preserve versions, forwarding, linked files and resources', () => {
  const builder = new MetadataBuilder('Manifest');
  builder.rows[Tables.Assembly] = [];
  builder.manifest.assembly({ HashAlgId: 0x8004, MajorVersion: 1, MinorVersion: 2, BuildNumber: 3,
    RevisionNumber: 4, Flags: 1, PublicKey: new Uint8Array([1, 2]), Name: 'FullIdentity', Culture: 'pl-PL' });
  const reference = builder.manifest.assemblyRef({ MajorVersion: 5, MinorVersion: 6, BuildNumber: 7,
    RevisionNumber: 8, Flags: 0, PublicKeyOrToken: new Uint8Array(8), Name: 'Dependency', Culture: '', HashValue: 0 });
  const file = builder.manifest.file({ Flags: 0, Name: 'Linked.netmodule', HashValue: new Uint8Array([42]) });
  builder.manifest.moduleRef({ Name: 'NativeLibrary' });
  builder.manifest.exportedType({ Flags: 0x200001, TypeDefId: 0, TypeName: 'Forwarded',
    TypeNamespace: 'Demo', Implementation: reference });
  builder.manifest.manifestResource({ Offset: 16, Flags: 1, Name: 'LinkedResource', Implementation: file });
  const metadata = readMetadata(builder.finish());
  assert.deepEqual(metadata.rows[32][0].slice(0, 6), [0x8004, 1, 2, 3, 4, 1]);
  assert.equal(metadata.string(metadata.rows[32][0][8]), 'pl-PL');
  assert.equal(decodeCoded('Implementation', metadata.rows[39][0][4]), reference);
  assert.equal(decodeCoded('Implementation', metadata.rows[40][0][3]), file);
  assert.equal(metadata.string(metadata.rows[26][0][0]), 'NativeLibrary');
  assert.throws(() => builder.manifest.manifestResource({ Offset: -1, Flags: 0, Name: 'Bad', Implementation: 0 }), /Invalid/);
  assert.throws(() => builder.manifest.exportedType({ Flags: 0, TypeDefId: 0, TypeName: 'Bad',
    TypeNamespace: '', Implementation: 0x02000001 }), /cannot be encoded/);
});
