import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { AssemblyInspector, decodeCoded, decodeCustomAttribute, MethodAttributes } from '@sharpforge/cil';

const source = readFileSync(new URL('./fixtures/a03-reference-assemblies/surface.cs', import.meta.url), 'utf8');
const compilerGenerated = 'System.Runtime.CompilerServices.CompilerGeneratedAttribute';
const debuggerBrowsable = 'System.Diagnostics.DebuggerBrowsableAttribute';
const debuggerState = 'System.Diagnostics.DebuggerBrowsableState';
const readOnly = 'System.Runtime.CompilerServices.IsReadOnlyAttribute';

function emit(text = source, options = {}) {
  const result = compileToReferenceAssembly(text, { name: 'RefSurface', refout: true, allowUnsafe: true, ...options });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return new AssemblyInspector(result.assembly);
}

function declared(inspector, name) {
  return inspector.types.find(type => type.name === name) ?? assert.fail(`missing ${name}`);
}

function attributes(inspector, parent) {
  const metadata = inspector.metadata;
  return (metadata.rows[12] ?? []).filter(row => decodeCoded('HasCustomAttribute', row[0]) === parent).map(([, type, value]) => {
    const constructor = decodeCoded('CustomAttributeType', type);
    const owner = metadata.typeName(decodeCoded('MemberRefParent', metadata.row(constructor)[0]));
    const decoded = decodeCustomAttribute(metadata.blob(value), constructor,
      { metadata, enumUnderlyingType: name => name === debuggerState ? 'int' : undefined });
    assert.equal(decoded.success, true, `${owner}: ${JSON.stringify(decoded.diagnostics)}`);
    return { name: owner, arguments: decoded.constructorArguments.map(argument => argument.value),
      signature: inspector.signature(constructor), blob: [...metadata.blob(value)] };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

// Pinned from SDK 10.0.201 / Roslyn 5.3.0-2.26153.122 / CoreCLR 10.0.5, public-expected.json at b939cb00.
test('A03-T22 retained property and primary-constructor storage has Roslyn debugger attributes', () => {
  const inspector = emit();
  for (const [owner, name] of [['RefSurface.Payload', '<Value>k__BackingField'], ['RefSurface.Captured', '<value>P']]) {
    const field = declared(inspector, owner).fields.find(field => field.name === name);
    const applied = attributes(inspector, field.token);
    assert.deepEqual(applied.map(attribute => [attribute.name, attribute.arguments]), [[debuggerBrowsable, [0]], [compilerGenerated, []]]);
    assert.deepEqual(applied[0].signature.parameters, [debuggerState]);
    assert.deepEqual(applied[0].blob, [1, 0, 0, 0, 0, 0, 0, 0]);
  }
  for (const field of declared(inspector, 'RefSurface.Payload').fields.filter(field => field.name !== '<Value>k__BackingField')) {
    assert.deepEqual(attributes(inspector, field.token), [], 'user-declared fields have no synthesized debugger attributes');
  }
});

test('A03-T22 readonly auto getters are marked only for the instance struct contract', () => {
  const inspector = emit('public struct S { public int Value { get; set; } public static int Static { get; set; } }'
    + 'public class C { public int Value { get; set; } }');
  const structure = declared(inspector, 'S');
  assert.deepEqual(attributes(inspector, structure.methods.find(method => method.name === 'get_Value').token)
    .map(attribute => attribute.name), [compilerGenerated, readOnly]);
  for (const name of ['set_Value', 'get_Static', 'set_Static']) {
    assert.deepEqual(attributes(inspector, structure.methods.find(method => method.name === name).token)
      .map(attribute => attribute.name), [compilerGenerated]);
  }
  const getter = declared(inspector, 'C').methods.find(method => method.name === 'get_Value');
  assert.deepEqual(attributes(inspector, getter.token).map(attribute => attribute.name), [compilerGenerated]);
});

test('A03-T22 virtual access checks and static interface event slots match captured Roslyn flags', () => {
  const inspector = emit();
  const contract = declared(inspector, 'RefSurface.Contract');
  assert.equal(contract.methods.find(method => method.name === 'Virtual').flags, 963);
  for (const name of ['Read', 'Protected', 'RefSurface.IContract.Read']) {
    assert.equal(contract.methods.find(method => method.name === name).flags & MethodAttributes.Strict, 0);
  }
  for (const name of ['add_Changed', 'remove_Changed']) {
    assert.equal(declared(inspector, 'RefSurface.IFactory').methods.find(method => method.name === name).flags, 3286);
    assert.ok(declared(inspector, 'RefSurface.IContract').methods.find(method => method.name === name).flags & MethodAttributes.NewSlot);
  }
});

test('A03-T22 fixed-buffer attributes preserve element types and lengths when storage definitions are omitted', () => {
  const inspector = emit();
  for (const [owner, element, length] of [
    ['RefSurface.Packet', 'System.Int32', 4],
    ['RefSurface.GenericPacket`1', 'System.Int32', 3],
    ['RefSurface.Envelope`1+Packet`1', 'System.Byte', 4],
  ]) {
    const field = declared(inspector, owner).fields.find(field => field.name === 'Data');
    assert.deepEqual(attributes(inspector, field.token).map(attribute => [attribute.name, attribute.arguments]),
      [['System.Runtime.CompilerServices.FixedBufferAttribute',
        [element + ', System.Runtime, Version=8.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a', length]]]);
  }
});

test('A03-T22 serialized fixed-buffer element identity follows the selected framework contract', () => {
  const inspector = emit('public unsafe struct S { public fixed byte Data[1]; }', { framework: 'mscorlib4' });
  const field = declared(inspector, 'S').fields[0];
  assert.deepEqual(attributes(inspector, field.token)[0].arguments,
    ['System.Byte, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089', 1]);
});

test('A03-T22 legacy metadata-only output keeps its existing synthesized attribute profile', () => {
  const inspector = emit('public struct S { public int Value { get; set; } }', { refout: false });
  const structure = declared(inspector, 'S');
  for (const member of [...structure.fields, ...structure.methods]) {
    assert.deepEqual(attributes(inspector, member.token).map(attribute => attribute.name), [compilerGenerated]);
  }
});
