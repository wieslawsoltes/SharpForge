import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { AssemblyInspector, decodeCoded, TypeAttributes, MethodAttributes } from '@sharpforge/cil';

const source = readFileSync(new URL('./fixtures/a03-reference-assemblies/surface.cs', import.meta.url), 'utf8');
const markerName = 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute';
const friend = '[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Friend")]\n';

function emit(text = source, options = {}) {
  const result = compileToReferenceAssembly(text, { name: 'RefSurface', refout: true, allowUnsafe: true, ...options });
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  const inspector = new AssemblyInspector(result.assembly);
  return { bytes: result.assembly, inspector, metadata: inspector.metadata };
}

function declared(inspector, name) {
  const type = inspector.types.find(candidate => candidate.name === name);
  assert.ok(type, `missing TypeDef ${name}`);
  return type;
}

function names(type, kind) {
  return type[kind].map(member => member.name).sort();
}

function markers(metadata) {
  return (metadata.rows[12] ?? []).filter(([parent, constructor]) => {
    if (decodeCoded('HasCustomAttribute', parent) !== 0x20000001) return false;
    const token = decodeCoded('CustomAttributeType', constructor);
    if (token >>> 24 !== 10) return false;
    const member = metadata.row(token);
    return metadata.typeName(decodeCoded('MemberRefParent', member[0])) === markerName;
  });
}

test('A03-T22 refout marks the image and emits only throw-null, abstract or runtime method bodies', () => {
  const { inspector, metadata } = emit();
  assert.equal(markers(metadata).length, 1);
  assert.deepEqual([...metadata.blob(markers(metadata)[0][2])], [1, 0, 0, 0]);
  const rvas = new Set();
  for (const type of inspector.types) {
    for (const method of type.methods) {
      if (!method.rva) {
        assert.ok((method.flags & MethodAttributes.Abstract) || (method.implFlags & 3) === 3);
        continue;
      }
      rvas.add(method.rva);
      assert.deepEqual(inspector.getMethod(method.token).instructions.map(instruction => instruction.name), ['ldnull', 'throw']);
    }
  }
  assert.equal(rvas.size, 1);
  assert.equal(inspector.pe.entryPoint, 0);
});

test('A03-T22 private and internal class storage and functions are stripped without leaving accessor rows', () => {
  const { inspector, metadata } = emit();
  const contract = declared(inspector, 'RefSurface.Contract');
  assert.deepEqual(names(contract, 'fields'), ['Answer', 'protectedField']);
  assert.deepEqual(names(contract, 'properties'), ['Value']);
  assert.deepEqual(names(contract, 'events'), ['Changed']);
  const methodNames = names(contract, 'methods');
  for (const removed of ['Hidden', 'Internal', '.cctor', 'set_Value', 'get_SecretProperty', 'set_InternalProperty', 'add_SecretEvent']) {
    assert.equal(methodNames.includes(removed), false, removed);
  }
  for (const kept of ['.ctor', 'Read', 'Protected', 'Virtual', 'get_Value', 'add_Changed', 'remove_Changed', 'RefSurface.IContract.Read']) {
    assert.equal(methodNames.includes(kept), true, kept);
  }
  assert.equal(methodNames.filter(name => name === '.ctor').length, 1);
  assert.equal(contract.flags & TypeAttributes.BeforeFieldInit, 0, 'a removed static constructor still determines type flags');
  for (const [, row] of metadata.rows[24] ?? []) assert.ok(metadata.rows[6][row - 1], 'live MethodSemantics target');
});

test('A03-T22 all declared types, struct fields and attribute constructors remain in the reference surface', () => {
  const { inspector } = emit();
  const nested = declared(inspector, 'RefSurface.Contract+Nested');
  assert.deepEqual(names(nested, 'methods'), ['.ctor', 'Visible']);
  const attribute = declared(inspector, 'RefSurface.LocalAttribute');
  assert.deepEqual(names(attribute, 'methods'), ['.ctor']);
  const payload = declared(inspector, 'RefSurface.Payload');
  assert.deepEqual(names(payload, 'fields'), ['<Value>k__BackingField', 'cached', 'number', 'reference']);
  assert.deepEqual(names(payload, 'methods'), ['get_Value']);
  assert.deepEqual(names(declared(inspector, 'RefSurface.Choice'), 'fields'), ['First', 'Second', 'value__']);
  assert.deepEqual(names(declared(inspector, 'RefSurface.Callback'), 'methods'), ['.ctor', 'BeginInvoke', 'EndInvoke', 'Invoke']);
});

test('A03-T22 explicit properties and events retain virtual accessors and MethodImpl associations', () => {
  const text = `using System;
    public interface I { int Value { get; set; } event Action Changed; }
    public class C : I {
      int I.Value { get { return 1; } set { } }
      event Action I.Changed { add { } remove { } }
    }`;
  const { inspector, metadata } = emit(text);
  const type = declared(inspector, 'C');
  assert.deepEqual(names(type, 'properties'), ['I.Value']);
  assert.deepEqual(names(type, 'events'), ['I.Changed']);
  for (const method of type.methods.filter(method => method.name !== '.ctor')) {
    assert.ok(method.flags & MethodAttributes.Virtual);
    assert.equal(method.flags & MethodAttributes.MemberAccessMask, MethodAttributes.Private);
  }
  assert.equal(metadata.rows[25].length, 4);
  assert.equal(metadata.rows[24].length, 8);
});

test('A03-T22 InternalsVisibleTo keeps internal members while private accessors and storage are removed', () => {
  const { inspector } = emit(source.replace('using System;', 'using System;\n' + friend));
  const contract = declared(inspector, 'RefSurface.Contract');
  assert.deepEqual(names(contract, 'fields'), ['Answer', 'internalField', 'protectedField']);
  assert.deepEqual(names(contract, 'properties'), ['InternalProperty', 'Value']);
  assert.deepEqual(names(contract, 'events'), ['Changed', 'InternalEvent']);
  assert.equal(names(contract, 'methods').includes('Internal'), true);
  assert.equal(names(contract, 'methods').includes('Hidden'), false);
  assert.equal(names(contract, 'methods').includes('set_Value'), false);
});

test('A03-T22 explicit static interface methods and accessors survive without a Virtual method flag', () => {
  const { inspector, metadata } = emit();
  const factory = declared(inspector, 'RefSurface.Factory');
  assert.deepEqual(names(factory, 'methods'), [
    '.ctor', 'RefSurface.IFactory.Create', 'RefSurface.IFactory.add_Changed',
    'RefSurface.IFactory.get_Value', 'RefSurface.IFactory.remove_Changed',
  ]);
  assert.deepEqual(names(factory, 'properties'), ['RefSurface.IFactory.Value']);
  assert.deepEqual(names(factory, 'events'), ['RefSurface.IFactory.Changed']);
  for (const method of factory.methods.filter(method => method.name !== '.ctor')) {
    assert.equal(method.flags & MethodAttributes.Virtual, 0);
    assert.equal(method.flags & MethodAttributes.MemberAccessMask, MethodAttributes.Private);
    assert.ok(method.flags & MethodAttributes.Static);
  }
  assert.equal(metadata.rows[25].filter(([owner]) => owner === (factory.token & 0xffffff)).length, 4);
});

test('A03-T22 fixed buffers and captured primary-constructor parameters retain struct layout metadata', () => {
  const { inspector, metadata } = emit();
  const packet = declared(inspector, 'RefSurface.Packet');
  assert.equal(inspector.signature(packet.fields[0].token).type, 'RefSurface.Packet+<Data>e__FixedBuffer');
  const buffer = declared(inspector, 'RefSurface.Packet+<Data>e__FixedBuffer');
  assert.deepEqual(names(buffer, 'fields'), ['FixedElementField']);
  assert.ok(metadata.rows[15].some(([, size, parent]) => size === 16 && parent === (buffer.token & 0xffffff)));
  const captured = declared(inspector, 'RefSurface.Captured');
  assert.deepEqual(names(captured, 'fields'), ['<value>P']);
});

test('A03-T22 fixed buffers in generic and nested generic structs preserve inherited parameters and storage signatures', () => {
  const { inspector, metadata } = emit();
  const cases = [
    ['RefSurface.GenericPacket`1', ['T'], 12],
    ['RefSurface.Envelope`1+Packet`1', ['T', 'U'], 4],
  ];
  for (const [ownerName, parameterNames, size] of cases) {
    const owner = declared(inspector, ownerName);
    const buffer = declared(inspector, ownerName + '+<Data>e__FixedBuffer');
    const parameters = metadata.rows[42].filter(row => decodeCoded('TypeOrMethodDef', row[2]) === buffer.token);
    assert.deepEqual(parameters.map(row => [row[0], metadata.string(row[3])]), parameterNames.map((name, index) => [index, name]));
    assert.equal(metadata.rows[15].find(([, , parent]) => parent === (buffer.token & 0xffffff))[1], size);
    const storage = owner.fields.find(field => field.name === 'Data');
    assert.deepEqual([...metadata.blob(storage.signatureToken)].slice(0, 3), [0x06, 0x15, 0x11], 'FieldSig GENERICINST VALUETYPE');
    assert.deepEqual(names(buffer, 'fields'), ['FixedElementField']);
  }
});

test('A03-T22 a generic fixed buffer still requires a positive source length', () => {
  const invalid = compileToReferenceAssembly('public unsafe struct S<T> { public fixed int Data[0]; }', { refout: true, allowUnsafe: true });
  assert.equal(invalid.success, false);
  assert.equal(invalid.assembly, null);
  assert.deepEqual(invalid.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => diagnostic.code), ['CS1665']);
});

test('A03-T22 body and stripped declaration edits leave the complete reference bytes unchanged', () => {
  const original = emit().bytes;
  const bodyEdit = source.replace('return 42;', 'int value = 21; return value + value;').replace('return 1;', 'return 100;');
  assert.deepEqual(emit(bodyEdit).bytes, original);
  const privateEdit = source.replace('private int secret;', 'private string renamed; private int Added() { return 9; }');
  assert.deepEqual(emit(privateEdit).bytes, original);
  assert.notDeepEqual(emit(source.replace('Answer = 42', 'Answer = 43')).bytes, original);
});

test('A03-T22 metadata-only default remains unchanged and an explicit reference marker is not duplicated', () => {
  const { inspector, metadata } = emit(source, { refout: false });
  assert.equal(names(declared(inspector, 'RefSurface.Contract'), 'fields').includes('secret'), true);
  assert.equal(markers(metadata).length, 0);
  const explicit = source.replace('using System;', 'using System;\n[assembly: System.Runtime.CompilerServices.ReferenceAssembly]');
  assert.equal(markers(emit(explicit).metadata).length, 1);
  assert.deepEqual(emit('').inspector.types.map(type => type.name), ['<Module>']);
});

test('A03-T22 generic marker and friend lookalikes do not suppress the real marker or expose internals', () => {
  const text = `
    [assembly: System.Runtime.CompilerServices.ReferenceAssembly<int>]
    [assembly: System.Runtime.CompilerServices.InternalsVisibleTo<int>("Friend")]
    namespace System.Runtime.CompilerServices {
      public class ReferenceAssemblyAttribute<T> : System.Attribute { public ReferenceAssemblyAttribute() { } }
      public class InternalsVisibleToAttribute<T> : System.Attribute { public InternalsVisibleToAttribute(string name) { } }
    }
    public class Contract { internal int Hidden() { return 1; } }`;
  const { inspector, metadata } = emit(text);
  assert.equal(markers(metadata).length, 1);
  assert.equal(names(declared(inspector, 'Contract'), 'methods').includes('Hidden'), false);
});

test('A03-T22 file-local well-known attributes follow Roslyn source-name recognition and retain mangled identities', () => {
  const text = `
    [assembly: System.Runtime.CompilerServices.ReferenceAssembly]
    [assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Friend")]
    namespace System.Runtime.CompilerServices {
      file class ReferenceAssemblyAttribute : System.Attribute { public ReferenceAssemblyAttribute() { } }
      file class InternalsVisibleToAttribute : System.Attribute { public InternalsVisibleToAttribute(string name) { } }
    }
    public class Contract { internal int Hidden() { return 1; } }`;
  const { inspector, metadata } = emit(text);
  // Roslyn SDK 10.0.201 recognizes these source names before file-local metadata mangling (edge-roslyn.json).
  assert.equal(markers(metadata).length, 0);
  assert.equal(names(declared(inspector, 'Contract'), 'methods').includes('Hidden'), true);
  assert.equal(inspector.types.filter(type => type.name.includes('__ReferenceAssemblyAttribute')).length, 1);
  const constructors = (metadata.rows[12] ?? [])
    .filter(([parent]) => decodeCoded('HasCustomAttribute', parent) === 0x20000001)
    .map(([, constructor]) => decodeCoded('CustomAttributeType', constructor));
  assert.deepEqual(constructors.map(token => token >>> 24), [6, 6]);
  assert.ok(constructors.some(token => inspector.resolveToken(token).owner.includes('__ReferenceAssemblyAttribute')));
  assert.ok(constructors.some(token => inspector.resolveToken(token).owner.includes('__InternalsVisibleToAttribute')));
});

test('A03-T22 invalid refout options and source errors report diagnostics with no assembly', () => {
  for (const options of [{ refout: 'true' }, { refout: null }, { refout: true, outputKind: 'netmodule' }]) {
    const result = compileToReferenceAssembly('', options);
    assert.equal(result.success, false);
    assert.equal(result.assembly, null);
    assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === 'SF3001'), true);
  }
  const erroneous = compileToReferenceAssembly('public class C { public int M() { return "bad"; } }', { refout: true });
  assert.equal(erroneous.success, false);
  assert.equal(erroneous.assembly, null);
  assert.equal(erroneous.diagnostics.some(diagnostic => diagnostic.code === 'CS0029'), true);
});
