import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, decodeCoded } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

// Real .NET comparison: packages/compiler/test/cil-emission/fixtures/generic-fixed-buffers.cs.

function emit(source) {
  const result = compileToAssembly(source, { name: 'GenericBuffers', allowUnsafe: true });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => `${entry.code}: ${entry.message}`), []);
  assert.ok(result.assembly);
  return new AssemblyInspector(result.assembly);
}

test('SF-A02-T51 a nested generic fixed buffer inherits every enclosing type parameter', () => {
  const inspector = emit(`
    unsafe class Outer<T> { public struct Packet<U> { public fixed int Data[3]; } }
    unsafe class Program { static void Main() { Outer<string>.Packet<int> packet = default; packet.Data[2] = 17; } }
  `);
  const buffer = inspector.types.find(type => type.name.endsWith('<Data>e__FixedBuffer'));
  assert.ok(buffer);
  const parameters = inspector.metadata.rows[42].filter(row => decodeCoded('TypeOrMethodDef', row[2]) === buffer.token);
  assert.equal(parameters.length, 2);
  const layout = inspector.metadata.rows[15].find(row => row[2] === (buffer.token & 0xffffff));
  assert.equal(layout[1], 12);
  const fieldRefs = inspector.metadata.rows[10].filter(row => inspector.metadata.string(row[1]) === 'Data');
  assert.ok(fieldRefs.length > 0);
  for (const field of fieldRefs) {
    const bytes = [...inspector.metadata.blob(field[2])];
    assert.deepEqual(bytes.slice(0, 3), [0x06, 0x15, 0x11], 'FieldSig GENERICINST VALUETYPE, not a native pointer');
  }
});

test('SF-A02-T51 fixed pinning accepts a buffer in a generic struct passed by reference', () => {
  const inspector = emit(`
    unsafe struct Packet<T> { public fixed int Data[3]; }
    unsafe class Program {
      static void Fill<T>(ref Packet<T> packet) { fixed (int* data = packet.Data) { data[2] = 19; } }
      static void Main() { Packet<int> packet = default; Fill(ref packet); }
    }
  `);
  const method = inspector.types.find(type => type.name === 'Program').methods.find(method => method.name === 'Fill');
  const names = inspector.getMethod(method.token).instructions.map(instruction => instruction.name);
  assert.equal(names.filter(name => name === 'ldflda').length, 2);
  assert.ok(names.includes('stind.i4'));
});

test('SF-A02-T47 fixed address-of a from-end array element emits ldelema', () => {
  const inspector = emit(`
    unsafe class Program { static void Main() { int[] values = { 2, 3 }; fixed (int* last = &values[^1]) { *last = 5; } } }
  `);
  const method = inspector.types.find(type => type.name === 'Program').methods.find(method => method.name === 'Main');
  const names = inspector.getMethod(method.token).instructions.map(instruction => instruction.name);
  assert.ok(names.includes('ldelema'));
  assert.ok(names.includes('sub'));
  assert.ok(names.includes('stind.i4'));
});

test('SF-A02-T47 a from-end element still needs fixed, and a range is not a variable', () => {
  const errors = source => compileToAssembly(source, { allowUnsafe: true }).diagnostics
    .filter(entry => entry.severity === 'error').map(entry => entry.code);
  assert.deepEqual(errors(`unsafe class Program { static void Main() { int[] values = { 1 }; int* last = &values[^1]; } }`), ['CS0212']);
  assert.deepEqual(errors(`unsafe class Program { static void Main() { int[] values = { 1 }; fixed (int* first = &values[..]) { } } }`), ['CS0211']);
});
