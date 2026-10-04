import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector } from '@sharpforge/cil';
import { compileToAssembly } from '@sharpforge/compiler';

test('SF-A02-T47 null data-pointer arguments, assignments and comparisons use native zero', () => {
  const result = compileToAssembly(`
    unsafe struct Node { public Node* Next; }
    unsafe class Program {
      static bool IsNull(int* pointer) => pointer == null;
      static bool IsFunctionNull(delegate*<int> pointer) => pointer == null;
      static bool Check() {
        int* pointer = null;
        void* raw = null;
        Node node = default;
        delegate*<int*, bool> check = &IsNull;
        return pointer == null && raw == null && node.Next == null && IsNull(null) && IsFunctionNull(null) && check(null);
      }
      static void Main() { Check(); }
    }
  `, { allowUnsafe: true, name: 'PointerNull' });
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.message), []);
  assert.ok(result.assembly);
  const inspector = new AssemblyInspector(result.assembly);
  const program = inspector.types.find(type => type.name === 'Program');
  for (const name of ['Check', 'IsNull', 'IsFunctionNull']) {
    const method = program.methods.find(candidate => candidate.name === name);
    const instructions = inspector.getMethod(method.token).instructions;
    assert.ok(!instructions.some(instruction => instruction.name === 'ldnull'), name + ' has no object-reference null');
    assert.ok(instructions.some(instruction => instruction.name === 'conv.u'), name + ' converts zero to a native integer');
  }
});

test('SF-A02-T47 null still cannot be passed to a non-nullable value parameter', () => {
  const result = compileToAssembly('class Program { static void Take(int value) { } static void Main() { Take(null); } }');
  assert.deepEqual(result.diagnostics.filter(entry => entry.severity === 'error').map(entry => entry.code), ['CS1503']);
  assert.equal(result.assembly, null);
});
