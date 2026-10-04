import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToAssembly, compileToReferenceAssembly } from '@sharpforge/compiler';
import { importAssembly } from '../packages/compiler/src/metadata-import/pe-symbols.js';
import { ridOf } from '../packages/compiler/src/metadata-import/pe-metadata.js';
import { parseCompilerInput } from '../packages/compiler/src/parse-input.js';
import { SemanticAnalysis } from '../packages/compiler/src/semantic-analysis.js';
import { emitReferenceAssembly } from '../packages/compiler/src/codegen/metadata/reference-assembly.js';
import { RefKind } from '../packages/compiler/src/symbols/types.js';

const fixture = readFileSync(new URL('./fixtures/imported-extension-blocks/ExtensionLibrary.cs', import.meta.url), 'utf8');
const core = importAssembly(new Uint8Array(readFileSync(new URL('./fixtures/metadata/MiniStandard.dll', import.meta.url))));
const extensionsName = 'ExtensionImport.Extensions';
const markerAttribute = 'System.Runtime.CompilerServices.ExtensionMarkerAttribute';
const errors = result => result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(d => `${d.code}: ${d.message}`);

function imported(bytes) {
  const assembly = importAssembly(bytes);
  assembly.setReferencedAssemblies(assembly.referencedAssemblyIdentities.map(() => core));
  assembly.corLibrary = core;
  return assembly;
}

function emitted(source = fixture, emit = compileToReferenceAssembly) {
  const result = emit(source, { name: 'ExtensionExports', outputKind: 'library', langVersion: '14' });
  assert.deepEqual(errors(result), []);
  assert.ok(result.assembly instanceof Uint8Array);
  return imported(result.assembly);
}

const attributes = (assembly, symbol) => assembly.metadata.customAttributes(symbol.metadataToken).map(attribute => attribute.fullName);
const flags = (assembly, symbol) => assembly.metadata.row(symbol.metadataToken >>> 24, ridOf(symbol.metadataToken))[0];
const declaration = (owner, name) => owner.extensionMembers.find(entry => entry.name === name)?.symbol;

test('A02-T83 executable and reference assemblies publish grouping and marker metadata with original implementations', () => {
  for (const emit of [compileToAssembly, compileToReferenceAssembly]) {
    const assembly = emitted(fixture, emit);
    const owner = assembly.getTypeByMetadataName(extensionsName);
    const groups = owner.getTypeMembers();
    assert.equal(groups.length, 7);
    for (const group of groups) {
      assert.equal(flags(assembly, group), 0x502, 'nested public, sealed and specialname, without beforefieldinit');
      assert.ok(attributes(assembly, group).includes('System.Runtime.CompilerServices.ExtensionAttribute'));
      for (const marker of group.getTypeMembers()) {
        assert.equal(marker.arity, 0);
        assert.equal(flags(assembly, marker), 0x582, 'the marker adds abstract to the grouping flags');
        assert.equal(assembly.metadata.genericParameters(marker.metadataToken).length, group.arity);
        assert.equal(marker.getMembers('<Extension>$').length, 1);
      }
    }
    assert.equal(declaration(owner, 'Twice').getMethod, owner.getMembers('get_Twice')[0]);
    assert.equal(declaration(owner, 'Item').setMethod, owner.getMembers('set_Item')[0]);
    assert.equal(declaration(owner, 'New'), owner.getMembers('New')[0]);
    assert.equal(declaration(owner, 'op_Addition'), owner.getMembers('op_Addition')[0]);
    assert.equal(owner.getMembers('get_Twice')[0].associatedSymbol, null);
    assert.equal(owner.getMembers('Twice').length, 0);
    assert.ok(assembly.getTypeByMetadataName(markerAttribute), 'the closed reference surface gets a local marker definition');
  }
});

test('A02-T83 generic declarations retain marker names, mapped receiver slots and method constraints', () => {
  const assembly = emitted();
  const owner = assembly.getTypeByMetadataName(extensionsName);
  const item = declaration(owner, 'Item');
  assert.equal(item.getMethod.returnType, item.getMethod.typeParameters[0]);
  assert.equal(item.setMethod.parameters[1].type, item.setMethod.typeParameters[0]);
  assert.equal(item.getMethod.extensionReceiverType.typeArguments[0].type, item.getMethod.typeParameters[0]);
  const mapped = declaration(owner, 'SameType');
  assert.equal(mapped.typeParameters[1].constraintTypes[0].type, mapped.typeParameters[0]);
  assert.equal(declaration(owner, 'Current').getMethod.extensionReceiver.refKind, RefKind.Ref);
  assert.equal(declaration(owner, 'IsUnmanaged').getMethod.typeParameters[0].hasUnmanagedTypeConstraint, true);
  const group = owner.getTypeMembers().find(type => type.getMembers('Map').length);
  assert.deepEqual(group.typeParameters.map(parameter => parameter.name), ['$T0']);
  const marker = group.getTypeMembers()[0];
  assert.deepEqual(assembly.metadata.genericParameters(marker.metadataToken).map(parameter => parameter.name), ['T']);
  assert.equal(group.getMembers('Map')[0].arity, 1);
  assert.equal(group.getMembers('Map')[0].parameters.length, 1);
});

test('A02-T83 grouping declarations preserve optional defaults, parameter names, properties and accessor marker attributes', () => {
  const assembly = emitted();
  const owner = assembly.getTypeByMetadataName(extensionsName);
  const group = owner.getTypeMembers().find(type => type.getMembers('Add').length);
  const method = group.getMembers('Add')[0];
  assert.equal(method.isStatic, false);
  assert.deepEqual(method.parameters.map(parameter => parameter.name), ['offset']);
  assert.equal(method.parameters[0].explicitDefaultValue, 3);
  assert.equal(method.parameters[0].isOptional, true);
  assert.ok(attributes(assembly, method).includes(markerAttribute));
  const property = group.getMembers('Writable')[0];
  for (const member of [property, property.getMethod, property.setMethod]) assert.ok(attributes(assembly, member).includes(markerAttribute));
  assert.equal(property.getMethod.isStatic, false);
  assert.equal(group.getMembers('Zero')[0].getMethod.isStatic, true);
});

test('A02-T83 static-only and property-only extension containers are marked at class and assembly scope', () => {
  const assembly = emitted(`public static class StaticOnly { extension(int) { public static int Zero => 0; } }
    public static class PropertyOnly { extension(string value) { public int Triple => value.Length * 3; } }`);
  for (const name of ['StaticOnly', 'PropertyOnly']) {
    const owner = assembly.getTypeByMetadataName(name);
    assert.ok(attributes(assembly, owner).includes('System.Runtime.CompilerServices.ExtensionAttribute'));
    assert.equal(owner.extensionMembers.length, 1);
  }
  const marked = assembly.metadata.customAttributes(0x20000001).filter(attribute =>
    attribute.fullName === 'System.Runtime.CompilerServices.ExtensionAttribute');
  assert.equal(marked.length, 1);
});

test('A02-T83 blocks with one CLR receiver share their group while exact receiver names retain distinct markers', () => {
  const source = `public static class Extensions {
    extension(string first) { public int Length1 => first.Length; }
    extension(string second) { public int Length2 => second.Length; }
  }`;
  const owner = emitted(source).getTypeByMetadataName('Extensions');
  assert.equal(owner.getTypeMembers().length, 1);
  assert.equal(owner.getTypeMembers()[0].getTypeMembers().length, 2);
  assert.equal(owner.extensionMembers.length, 2);
});

test('A02-T83 grouping and marker names are stable under declaration reordering and source relocation', () => {
  const blocks = [
    'extension(string first) { public int A => first.Length; }',
    'extension(string second) { public int B => second.Length; }',
    'extension(int number) { public int C => number; }',
  ];
  const names = (sequence, uri) => {
    const source = [{ uri, text: 'public static class Extensions {' + sequence.join('\n') + '}' }];
    const owner = emitted(source).getTypeByMetadataName('Extensions');
    return owner.getTypeMembers().map(group => [group.metadataName, group.getTypeMembers().map(marker => marker.metadataName).sort()]).sort();
  };
  assert.deepEqual(names(blocks, '/src/first.cs'), names([...blocks].reverse(), '/relocated/second.cs'));
});

test('A02-T83 metadata planning does not mutate source declarations or their original parameter ownership', () => {
  const analysis = new SemanticAnalysis(parseCompilerInput(fixture, { name: 'ExtensionExports' }), { name: 'ExtensionExports', langVersion: '14' });
  assert.deepEqual(errors(analysis.run()), []);
  const owner = analysis.assembly.types.find(type => type.name === 'Extensions');
  const members = [...owner.getMembers()];
  const parameters = members.flatMap(method => method.parameters ?? []);
  const parameterOwners = parameters.map(parameter => parameter.containingSymbol);
  const first = emitReferenceAssembly(analysis, { name: 'ExtensionExports' }).bytes;
  const second = emitReferenceAssembly(analysis, { name: 'ExtensionExports' }).bytes;
  assert.deepEqual(first, second);
  assert.deepEqual(owner.getMembers(), members);
  assert.deepEqual(parameters.map(parameter => parameter.containingSymbol), parameterOwners);
  assert.equal(owner.getTypeMembers().length, 0);
});

test('A02-T83 ordinary types and empty blocks do not receive extension marker types', () => {
  const assembly = emitted('public class Plain { public int Value; } public static class Empty { extension(int number) { } }');
  assert.equal(assembly.getTypeByMetadataName('Plain').getTypeMembers().length, 0);
  assert.equal(assembly.getTypeByMetadataName('Empty').getTypeMembers().length, 0);
  assert.equal(assembly.getTypeByMetadataName(markerAttribute), null);
});

test('A02-T83 an invalid explicitly provided marker constructor produces a metadata diagnostic', () => {
  const result = compileToReferenceAssembly(`namespace System.Runtime.CompilerServices {
    public sealed class ExtensionMarkerAttribute : System.Attribute { public ExtensionMarkerAttribute(int name) { } }
  }
  public static class E { extension(int number) { public int P => number; } }`, { langVersion: '14' });
  assert.equal(result.success, false);
  assert.ok(errors(result).some(error => error.includes('ExtensionMarkerAttribute') && error.includes('string')), errors(result).join('\n'));
  assert.equal(result.assembly, null);
});
