import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { AssemblyInspector } from '@sharpforge/cil';
import { ReferenceManager } from '../packages/compiler/src/metadata-import/reference-manager.js';
import { MetadataView } from '../packages/compiler/src/metadata-import/pe-metadata.js';
import { embeddedAttributeDefinitions, nullableAttributeRows } from './fixtures/nullable-metadata/inspect-metadata.mjs';
import { legacyNullableReferences } from './fixtures/nullable-metadata/legacy-references.mjs';

const fixture = name => readFileSync(new URL('./fixtures/nullable-metadata/' + name, import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const errors = result => result.diagnostics.filter(item => item.severity === 'error');
const legacy = legacyNullableReferences();
const available = { skip: legacy ? false : 'no .NET reference pack installed' };

test('A02-T05.3 embedded attribute oracle has genuine Roslyn and reference-projection provenance', () => {
  const provenance = JSON.parse(fixture('legacy-provenance.json'));
  assert.equal(provenance.sourceSha256, sha256(fixture(provenance.source)));
  assert.equal(provenance.assemblySha256, sha256(fixture('LegacyNullableMetadata.dll')));
  assert.match(provenance.referenceProjection.description, /not a historical SDK/);
  assert.equal(provenance.referenceProjection.renamed.length, 2);
  assert.deepEqual(embeddedAttributeDefinitions(fixture('LegacyNullableMetadata.dll')), JSON.parse(fixture('roslyn-embedded-definitions.json')));
  assert.deepEqual(nullableAttributeRows(fixture('LegacyNullableMetadata.dll')), JSON.parse(fixture('roslyn-legacy-attributes.json')));
});

test('A02-T05.3 the temporary reference projection changes only two identifiers in a fresh copy', available, () => {
  const original = new AssemblyInspector(legacy.original), projected = new AssemblyInspector(legacy.projection.bytes);
  assert.equal(legacy.original.length, legacy.projection.bytes.length);
  let changed = 0;
  for (let index = 0; index < legacy.original.length; index++) if (legacy.original[index] !== legacy.projection.bytes[index]) changed++;
  assert.equal(changed, 2);
  for (const { from, to } of legacy.projection.renamed) {
    assert.ok(original.types.some(type => type.name === from));
    assert.ok(!projected.types.some(type => type.name === from));
    assert.ok(projected.types.some(type => type.name === to));
  }
});

test('A02-T05.3 both assembly APIs embed complete nullable attributes matching Roslyn', available, () => {
  const source = fixture('NullableMetadata.cs').toString('utf8');
  const expected = embeddedAttributeDefinitions(fixture('LegacyNullableMetadata.dll'));
  assert.equal(expected.length, 3);
  for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
    const result = emit(source, { name: 'LegacyNullableMetadata', outputKind: 'library', allowUnsafe: true, references: legacy.references });
    assert.deepEqual(errors(result), []);
    assert.ok(result.assembly);
    assert.deepEqual(embeddedAttributeDefinitions(result.assembly), expected);
    const view = new MetadataView(result.assembly);
    assert.ok(nullableAttributeRows(result.assembly).length > 0);
    const assembly = new ReferenceManager([...legacy.references, { bytes: result.assembly }]).assemblies
      .find(item => item.name === 'LegacyNullableMetadata');
    const surface = assembly.getTypeByMetadataName('NullableMetadata.Surface`6');
    assert.equal(surface.getMembers('Field')[0].typeWithAnnotations.isAnnotated, true);
    assert.equal(surface.typeParameters[0].hasNotNullConstraint, true);
    assert.equal(surface.typeParameters[2].referenceTypeConstraintIsNullable, true);
    for (const row of view.md.rows[1] ?? []) {
      const name = view.md.string(row[1]);
      assert.ok(name !== 'NullableAttribute' && name !== 'NullableContextAttribute', 'local constructors must not name missing framework TypeRefs');
    }
  }
});

function customContract(name, body, declaration = 'sealed class', base = ' : System.Attribute') {
  return `namespace System.Runtime.CompilerServices { public ${declaration} ${name}${base} { ${body} } }
    #nullable enable
    public class Consumer { public string? Read(string first, string second) => null; }
  `;
}

test('A02-T05.3 existing source constructors are reused independently for Nullable and NullableContext', () => {
  for (const name of ['NullableAttribute', 'NullableContextAttribute']) {
    const source = customContract(name, `public ${name}(byte flag) { }`);
    const result = compileToAssembly(source, { outputKind: 'library' });
    assert.deepEqual(errors(result), []);
    const inspector = new AssemblyInspector(result.assembly), view = new MetadataView(result.assembly);
    assert.equal(inspector.types.filter(type => type.name === 'System.Runtime.CompilerServices.' + name).length, 1);
    const uses = [];
    for (const type of inspector.types) {
      const targets = [type.token, ...type.methods.map(method => method.token), ...type.methods.flatMap(method => view.md.list(method.token, 'ParamList'))];
      for (const target of targets) uses.push(...view.customAttributes(target).filter(attribute => attribute.name === name));
    }
    assert.ok(uses.length > 0);
    assert.ok(uses.every(attribute => attribute.constructorToken >>> 24 === 6));
  }
});

test('A02-T05.3 malformed declared nullable contracts fail before an invalid custom attribute can be emitted', () => {
  for (const name of ['NullableAttribute', 'NullableContextAttribute']) {
    for (const source of [
      customContract(name, `public ${name}(byte flag) { }`, 'sealed class', ''),
      customContract(name, `public ${name}(byte flag) { }`, 'abstract class'),
      customContract(name, `public ${name}(string flag) { }`),
    ]) {
      const result = compileToAssembly(source, { outputKind: 'library' });
      assert.equal(result.assembly, null);
      assert.ok(errors(result).some(diagnostic => diagnostic.code === 'SF3001' && /constructor|derived from System.Attribute/.test(diagnostic.message)));
    }
  }
});
