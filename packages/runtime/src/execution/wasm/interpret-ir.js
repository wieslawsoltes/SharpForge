import {float} from '../numeric-ops.js';

/** Reference executor for a single typed IR instruction at an existing CIL safepoint. */
export function interpretWasmInstruction(vm, frame, instruction, hostHandler) {
  if (instruction.kind === 'host') return hostHandler(vm, frame, frame.method.instructions[instruction.pc]);
  if (instruction.kind === 'constant') {
    const value = instruction.type === 'f32' || instruction.type === 'f64' ?
      float(instruction.value, instruction.type === 'f32' ? 'r4' : 'r8') : instruction.value;
    vm.push(value);
    return;
  }
  if (instruction.kind === 'unary') {
    vm.push(vm.unary(instruction.name, vm.pop()));
    return;
  }
  const right = vm.pop();
  vm.push(vm.binary(instruction.name, vm.pop(), right));
}
