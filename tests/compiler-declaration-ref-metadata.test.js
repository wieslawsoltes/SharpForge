import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { MetadataView, findType, findMethod, methodSnapshot, genericSnapshot, attributeSnapshot, extensionMarker } from
  './fixtures/exported-extension-blocks/metadata.mjs';

const fixture = name => new URL('./fixtures/exported-extension-blocks/' + name, import.meta.url);
const source = readFileSync(fixture('DeclarationMetadata.cs'), 'utf8');
const oracle = new MetadataView(new Uint8Array(readFileSync(fixture('DeclarationMetadata.dll'))));
const namespace = 'DeclarationMetadata.';
const relevant = name => /\.(IsReadOnly|RequiresLocation|ScopedRef|IsUnmanaged|RefSafetyRules)Attribute$/.test(name);
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);

function emitted(emit) {
  const result = emit(source, { name: 'DeclarationExports', outputKind: 'library', langVersion: '14' });
  assert.deepEqual(errors(result), []);
  assert.ok(result.assembly instanceof Uint8Array);
  return new MetadataView(result.assembly);
}

test('A02-T83 declaration metadata oracle records its actual Roslyn compiler, source and assembly', () => {
  const provenance = JSON.parse(readFileSync(fixture('provenance.json'), 'utf8'));
  const hash = name => createHash('sha256').update(readFileSync(fixture(name))).digest('hex');
  assert.equal(provenance.source.sha256, hash('DeclarationMetadata.cs'));
  assert.equal(provenance.assembly.sha256, hash('DeclarationMetadata.dll'));
  assert.match(provenance.compilerVersion, /^5\.3\./);
  assert.equal(provenance.sdkVersion, '10.0.201');
  assert.equal(provenance.referencePackVersion, '10.0.5');
});

for (const [description, emit] of [['executable', compileToAssembly], ['reference', compileToReferenceAssembly]]) {
  test(`A02-T83 ${description} readonly, scoped and virtual declaration signatures match pinned Roslyn metadata`, () => {
    const actual = emitted(emit);
    const actualOwner = findType(actual, namespace + 'References'), expectedOwner = findType(oracle, namespace + 'References');
    for (const name of ['Read', 'Readonly', 'Return', 'Scope', 'ScopedOut', 'ScopedValue', 'Virtual']) {
      assert.deepEqual(methodSnapshot(actual, findMethod(actual, actualOwner, name), relevant),
        methodSnapshot(oracle, findMethod(oracle, expectedOwner, name), relevant), name);
    }
    const actualDelegate = findType(actual, namespace + 'ReadonlyDelegate'), expectedDelegate = findType(oracle, namespace + 'ReadonlyDelegate');
    assert.deepEqual(methodSnapshot(actual, findMethod(actual, actualDelegate, 'Invoke'), relevant),
      methodSnapshot(oracle, findMethod(oracle, expectedDelegate, 'Invoke'), relevant));
    assert.deepEqual(attributeSnapshot(actual, 1, relevant), attributeSnapshot(oracle, 1, relevant));
  });

  test(`A02-T83 ${description} unmanaged type, method, group and marker constraints match pinned Roslyn metadata`, () => {
    const actual = emitted(emit);
    const actualGeneric = findType(actual, namespace + 'Generic`1'), expectedGeneric = findType(oracle, namespace + 'Generic`1');
    assert.deepEqual(genericSnapshot(actual, actualGeneric, relevant), genericSnapshot(oracle, expectedGeneric, relevant));
    assert.deepEqual(methodSnapshot(actual, findMethod(actual, actualGeneric, 'Method'), relevant),
      methodSnapshot(oracle, findMethod(oracle, expectedGeneric, 'Method'), relevant));
    const actualOwner = findType(actual, namespace + 'Extensions'), expectedOwner = findType(oracle, namespace + 'Extensions');
    for (const name of ['get_ReadonlyValue', 'get_ScopedValue', 'set_ScopedValue', 'get_Head']) {
      assert.deepEqual(methodSnapshot(actual, findMethod(actual, actualOwner, name), relevant),
        methodSnapshot(oracle, findMethod(oracle, expectedOwner, name), relevant), name + ' implementation');
      const left = extensionMarker(actual, actualOwner, name), right = extensionMarker(oracle, expectedOwner, name);
      assert.deepEqual(genericSnapshot(actual, left.group, relevant), genericSnapshot(oracle, right.group, relevant), name + ' group');
      assert.deepEqual(genericSnapshot(actual, left.marker, relevant), genericSnapshot(oracle, right.marker, relevant), name + ' marker');
      assert.deepEqual(methodSnapshot(actual, findMethod(actual, left.marker, '<Extension>$'), relevant),
        methodSnapshot(oracle, findMethod(oracle, right.marker, '<Extension>$'), relevant), name + ' receiver');
    }
  });
}
