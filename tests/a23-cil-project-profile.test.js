import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, emitAssembly, loadAssembly, decodeCoded} from '@sharpforge/cil';
import {referenceFixture, consumer} from './support/cil-project-profile-fixture.js';

test('public CIL emission writes scoped references and round-trips all six external operations without a compiler consumer', () => {
  const fixture = referenceFixture();
  const image = consumer(fixture);
  const bytes = emitAssembly(image);
  const inspector = new AssemblyInspector(bytes);
  const metadata = inspector.metadata;
  const tokens = inspector.debug.referenceTokens;
  const reference = metadata.row(tokens.assemblies[0]);
  assert.equal(metadata.string(reference[6]), 'MetadataLibrary');
  assert.deepEqual(reference.slice(0, 4), [1, 2, 3, 4]);
  assert.equal(decodeCoded('ResolutionScope', metadata.row(tokens.types[0])[0]), tokens.assemblies[0]);
  assert.equal(metadata.typeName(tokens.types[0]), 'Counter');
  assert(!inspector.types.some(type => type.name === 'Counter'), 'The dependency has no copied TypeDef in the consumer');
  for (const member of [...tokens.methods, ...tokens.fields]) {
    assert.equal(member >>> 24, 10);
    assert.equal(decodeCoded('MemberRefParent', metadata.row(member)[0]), tokens.types[0]);
  }
  const loaded = loadAssembly(bytes);
  assert.deepEqual(loaded.externalReferences, fixture.profile);
  assert.deepEqual(loaded.methods[0].code, image.methods[0].code);
  assert.equal(loaded.methods[0].locals[0].type, fixture.profile.types[0].imageName);
  assert.deepEqual(emitAssembly(loaded), bytes, 'Canonical unlinked replay retains the exact metadata and CIL');
});

test('public CIL emission rejects invalid external field modes and descriptor tokens before producing bytes', () => {
  const fixture = referenceFixture();
  const wrongMode = consumer(fixture);
  wrongMode.externalReferences.fields[fixture.instanceField].isStatic = true;
  assert.throws(() => emitAssembly(wrongMode), /Invalid compiler image.*access mode/);
  const invalidToken = consumer(referenceFixture());
  invalidToken.externalReferences.methods[0].token = 0x04000001;
  assert.throws(() => emitAssembly(invalidToken), /Invalid compiler image/);
});
