import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileToReferenceAssembly } from '@sharpforge/compiler';
import { AssemblyInspector, decodeCoded, TypeAttributes, MethodAttributes } from '@sharpforge/cil';

const source = readFileSync(new URL('./fixtures/a03-reference-assemblies/surface.cs', import.meta.url), 'utf8');
const markerName = 'System.Runtime.CompilerServices.ReferenceAssemblyAttribute';
const friend = '[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Friend")]\n';

function emit(text = source, options = {}) {
  const result = compileToReferenceAssembly(text, { name: 'RefSurface', refout: true, ...options });
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
