import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { AssemblyInspector, decodeCoded, MethodAttributes } from '@sharpforge/cil';

const edgeSource = readFileSync(new URL('./fixtures/a03-reference-assemblies/edge-source.cs', import.meta.url), 'utf8');
const native = JSON.parse(readFileSync(new URL('./fixtures/a03-reference-assemblies/edge-roslyn.json', import.meta.url), 'utf8'));

function emit(source) {
  const compiled = compileToReferenceAssembly(source, { name: 'InterfaceMembers', refout: true });
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return new AssemblyInspector(compiled.assembly);
}

function type(inspector, name) {
  return inspector.types.find(type => type.name === name) ?? assert.fail('Missing type: ' + name);
}

test('A03-T22 only accessors mapped by the binder gain an implicit interface slot', () => {
  const inspector = emit(`
    public interface IRead { int Value { get; } }
    public interface IWrite { int Value { set; } }
    public class Read : IRead { public int Value { get; private set; } }
    public class Write : IWrite { public int Value { private get; set; } }
    public class Both : IRead, IWrite { public int Value { get; set; } }`);
  for (const [name, accessors] of [['Read', ['get_Value']], ['Write', ['set_Value']], ['Both', ['get_Value', 'set_Value']]]) {
    const methods = type(inspector, name).methods.filter(method => method.name !== '.ctor');
    assert.deepEqual(methods.map(method => method.name).sort(), accessors);
    for (const method of methods) assert.ok(method.flags & MethodAttributes.Virtual);
  }
});

test('A03-T22 explicit interface names match Roslyn for aliases, constructed nested types, tuples and accessors', () => {
  const inspector = emit(edgeSource);
  for (const name of ['RefProbe.C', 'RefProbe.Nested', 'RefProbe.Tuple']) {
    const actual = type(inspector, name);
    const expected = native.surface.find(type => type.name === name);
    assert.ok(expected);
    for (const table of ['methods', 'properties', 'events']) {
      assert.deepEqual(actual[table].map(member => member.name).sort(), expected[table].map(member => member.name).sort());
    }
    assert.deepEqual(actual.methods.map(method => [method.name, method.flags]).sort(),
      expected.methods.map(method => [method.name, method.flags]).sort());
  }
});

test('A03-T22 an explicit-only indexer does not synthesize DefaultMemberAttribute', () => {
  const inspector = emit(edgeSource);
  const owner = type(inspector, 'RefProbe.C').token;
  const attributes = (inspector.metadata.rows[12] ?? []).filter(([parent]) => decodeCoded('HasCustomAttribute', parent) === owner);
  assert.equal(attributes.length, 0);
  assert.deepEqual(native.surface.find(type => type.name === 'RefProbe.C').attributes, []);
  const interfaceToken = type(inspector, 'RefProbe.I`1').token;
  assert.equal((inspector.metadata.rows[12] ?? []).filter(([parent]) =>
    decodeCoded('HasCustomAttribute', parent) === interfaceToken).length, 1);
});

test('A03-T22 qualified file-local attributes do not leak from another compilation file', () => {
  const inspector = emit([
    { uri: 'attributes.cs', text: `namespace System.Runtime.CompilerServices {
      file class ReferenceAssemblyAttribute : System.Attribute { public ReferenceAssemblyAttribute() { } }
    }` },
    { uri: 'contract.cs', text: `[assembly: System.Runtime.CompilerServices.ReferenceAssembly]
      public class Contract { internal void Hidden() { } }` },
  ]);
  const attributes = (inspector.metadata.rows[12] ?? []).filter(([parent]) => decodeCoded('HasCustomAttribute', parent) === 0x20000001);
  assert.equal(attributes.length, 1);
  const constructor = decodeCoded('CustomAttributeType', attributes[0][1]);
  assert.equal(constructor >>> 24, 10, 'the other file binds the framework marker constructor');
  assert.deepEqual(type(inspector, 'Contract').methods.map(method => method.name), ['.ctor']);
});

test('A03-T22 file-local attribute lookup follows namespace imports and type aliases', () => {
  const inspector = emit(`
    using System.Runtime.CompilerServices;
    using LocalMarker = System.Runtime.CompilerServices.ReferenceAssemblyAttribute;
    [assembly: LocalMarker]
    [assembly: InternalsVisibleTo("Friend")]
    namespace System.Runtime.CompilerServices {
      file class ReferenceAssemblyAttribute : System.Attribute { public ReferenceAssemblyAttribute() { } }
      file class InternalsVisibleToAttribute : System.Attribute { public InternalsVisibleToAttribute(string name) { } }
    }
    public class Contract { internal void Hidden() { } }`);
  const attributes = (inspector.metadata.rows[12] ?? []).filter(([parent]) => decodeCoded('HasCustomAttribute', parent) === 0x20000001);
  assert.deepEqual(attributes.map(([, constructor]) => decodeCoded('CustomAttributeType', constructor) >>> 24), [6, 6]);
  assert.deepEqual(type(inspector, 'Contract').methods.map(method => method.name).sort(), ['.ctor', 'Hidden']);
});

test('A03-T22 qualified generic file-local attributes bind their suffixed source type', () => {
  const inspector = emit(`
    [assembly: Local.Tag<int>]
    namespace Local { file class TagAttribute<T> : System.Attribute { public TagAttribute() { } } }
    public class Contract { internal void Hidden() { } }`);
  const attributes = (inspector.metadata.rows[12] ?? []).filter(([parent]) => decodeCoded('HasCustomAttribute', parent) === 0x20000001);
  const constructors = attributes.map(([, constructor]) => inspector.resolveToken(decodeCoded('CustomAttributeType', constructor)));
  assert.equal(constructors.length, 2);
  assert.ok(constructors.some(method => method.owner.includes('__TagAttribute`1')));
  assert.ok(constructors.some(method => method.owner === 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute'));
  assert.deepEqual(type(inspector, 'Contract').methods.map(method => method.name), ['.ctor']);
});
