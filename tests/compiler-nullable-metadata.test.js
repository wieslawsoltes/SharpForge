import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { loadReferencePack } from '@sharpforge/compiler/node';
import { ReferenceManager } from '../packages/compiler/src/metadata-import/reference-manager.js';
import { SymbolDisplayFormat, SymbolKind, TypeWithAnnotations } from '../packages/compiler/src/symbols/types.js';
import { encodeNullableFlags } from '../packages/compiler/src/nullable/metadata-flags.js';
import { nullableAttributeRows } from './fixtures/nullable-metadata/inspect-metadata.mjs';

const fixture = name => readFileSync(new URL('./fixtures/nullable-metadata/' + name, import.meta.url));
const pack = loadReferencePack();
const referenceOptions = { skip: pack ? false : 'no .NET reference pack installed' };
const errors = result => result.diagnostics.filter(item => item.severity === 'error');
const flagList = type => encodeNullableFlags(TypeWithAnnotations.create(type));
const display = symbol => symbol.toDisplayString(SymbolDisplayFormat.Signature);

function imported(bytes) {
  return new ReferenceManager([...pack.references, { bytes }]).assemblies.find(assembly => assembly.name === 'NullableMetadata');
}

function parameterShape(parameter) {
  return {
    reference: parameter.hasReferenceTypeConstraint,
    maybeReference: !!parameter.referenceTypeConstraintIsNullable,
    notNull: parameter.hasNotNullConstraint,
    value: parameter.hasValueTypeConstraint,
    constraints: parameter.constraintTypes.map(constraint => ({ type: display(constraint.type ?? constraint), flags: flagList(constraint) })),
  };
}

function typeShape(type) {
  assert.ok(type);
  const members = {};
  for (const member of type.getMembers()) {
    const name = display(member);
    if (member.kind === SymbolKind.Method) {
      members[name] = {
        returned: flagList(member.returnTypeWithAnnotations),
        parameters: member.parameters.map(parameter => flagList(parameter.typeWithAnnotations)),
        typeParameters: member.typeParameters.map(parameterShape),
      };
    } else if ([SymbolKind.Field, SymbolKind.Property, SymbolKind.Event].includes(member.kind)) {
      members[name] = flagList(member.typeWithAnnotations);
    }
  }
  return {
    parameters: type.typeParameters.map(parameterShape),
    base: type.baseType ? flagList(type.baseType) : null,
    interfaces: type.interfaces.map(type => ({ type: display(type), flags: flagList(type) })),
    members,
  };
}

test('A02-T29 oblivious ordinary declarations do not introduce nullable metadata', () => {
  const result = compileToAssembly('public class Plain { public string Field; public object Echo(object value) => value; }',
    { outputKind: 'library' });
  assert.deepEqual(errors(result), []);
  assert.deepEqual(nullableAttributeRows(result.assembly), []);
});

test('A02-T29 both assembly APIs preserve return and parameter annotations under a nullable context', () => {
  const source = '#nullable enable\npublic class Sample { public string? Read(string first, string second) => null; }';
  for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
    const result = emit(source, { outputKind: 'library' });
    assert.deepEqual(errors(result), []);
    const rows = nullableAttributeRows(result.assembly);
    assert.ok(rows.some(row => row.context === 1));
    assert.ok(rows.some(row => row.target.endsWith(':return') && row.nullable === 2));
    assert.ok(!rows.some(row => row.target.includes(':parameter:') && row.nullable !== null));
  }
});

test('A02-T05.3 nullable compilation options keep annotations independent from warnings', () => {
  const source = 'public class Options<T> { public string Field; }';
  for (const mode of ['disable', 'warnings', 'annotations', 'enable']) {
    const result = compileToAssembly(source, { outputKind: 'library', nullableContext: mode });
    assert.deepEqual(errors(result), []);
    const rows = nullableAttributeRows(result.assembly);
    if (mode === 'disable' || mode === 'warnings') assert.deepEqual(rows, [], mode);
    else {
      assert.ok(rows.some(row => row.target.endsWith('::field:Field') && row.nullable === 1), mode);
      assert.ok(rows.some(row => row.target.includes(':generic:0:T') && row.nullable === 2), mode);
    }
  }
});

test('A02-T05.3 nullable metadata fixture has genuine pinned Roslyn provenance', () => {
  const provenance = JSON.parse(fixture('provenance.json'));
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(provenance.sourceSha256, sha256(fixture('NullableMetadata.cs')));
  assert.equal(provenance.assemblySha256, sha256(fixture('NullableMetadata.dll')));
  assert.match(provenance.compiler, /^\d+\.\d+\./);
  assert.match(provenance.sdk, /^\d+\.\d+\./);
});

test('A02-T29 nullable metadata round-trips like Roslyn on every public signature and constraint target', referenceOptions, () => {
  const source = fixture('NullableMetadata.cs').toString('utf8');
  const reference = imported(fixture('NullableMetadata.dll'));
  for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
    const result = emit(source, { name: 'NullableMetadata', outputKind: 'library', allowUnsafe: true, references: pack.references });
    assert.deepEqual(errors(result), []);
    assert.ok(result.assembly);
    const actual = imported(result.assembly);
    for (const name of [
      'Surface`6', 'Constraints`6', 'Outer`1', 'Outer`1+Middle`1', 'Outer`1+Middle`1+Inner`1',
      'NestedUses', 'Contexts', 'EnabledRecord', 'ValueRecord', 'GenericRecord`1', 'Disabled`2',
      'DisabledRecord', 'OverrideBase', 'OverrideDerived',
    ]) {
      const metadataName = 'NullableMetadata.' + name;
      assert.deepEqual(typeShape(actual.getTypeByMetadataName(metadataName)), typeShape(reference.getTypeByMetadataName(metadataName)), metadataName);
    }
    const rows = nullableAttributeRows(result.assembly);
    assert.ok(rows.some(row => row.target.includes(':interface:') && Array.isArray(row.nullable)));
    assert.ok(rows.some(row => row.target.includes(':constraint:') && Array.isArray(row.nullable)));
    assert.ok(rows.some(row => row.target.includes(':generic:') && row.nullable !== null));
    assert.ok(rows.some(row => row.target.includes('::event:Changed') && row.nullable !== null));
  }
});
