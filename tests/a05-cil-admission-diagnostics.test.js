import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

for (const decodePlans of [false, true]) for (const [opcode, name, message] of [
  ['unknown.op', 'InvalidProgramException', "Unknown CIL opcode 'unknown.op'"],
  ['no.', 'NotSupportedException', "Opcode 'no.' is not executable"]
]) {
  test(`CIL opcode ${opcode} retains its explicit fault with decodePlans=${decodePlans}`, () => {
    const vm = new CilVirtualMachine(managedFixture(), {decodePlans});
    try {
      const original = vm.top.method;
      vm.top.method = {...original, instructions: [{...original.instructions[0], name: opcode}]};
      assert.throws(() => vm.step(), {name, message});
      vm.top.method = original;
      vm.top.pc = original.instructions.length;
      assert.throws(() => vm.step(), {
        name: 'InvalidProgramException', message: 'Instruction pointer is outside the method'
      });
    } finally { vm.stop(); }
  });
}

test('unknown inspected opcodes cannot acquire an execution verification proof', () => {
  const inspector = new AssemblyInspector(managedFixture());
  const method = inspector.getMethod(inspector.pe.entryPoint);
  method.instructions = [{...method.instructions[0], name: 'unknown.op'}];
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_OPCODE' && issue.message.includes('unknown.op')));
  assert.throws(() => new CilVirtualMachine(inspector), error => error.issues?.some(issue => issue.code === 'IL_OPCODE'));
});
