import {float} from '../numeric-ops.js';
import {scalarStorageGuard} from '../scalar-storage-plan.js';

const guards = Object.freeze({
  i32: scalarStorageGuard('int'), i64: scalarStorageGuard('long'),
  f32: scalarStorageGuard('float'), f64: scalarStorageGuard('double')
});

/** Reference executor for a single typed IR instruction at an existing CIL safepoint. */
export function interpretWasmInstruction(vm, frame, instruction, hostHandler) {
  if (instruction.kind === 'host') return hostHandler(vm, frame, frame.method.instructions[instruction.pc]);
  if (instruction.requiresOperandGuards) {
    const start = frame.stack.length - instruction.inputs.length;
    const matches = start >= 0 && instruction.inputs.every((type, index) =>
      guards[type]?.(frame.stack[start + index], vm.options));
    if (!matches) return hostHandler(vm, frame, frame.method.instructions[instruction.pc]);
  }
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
  if (instruction.kind !== 'binary') throw new TypeError('Unknown Wasm IR operation');
  const right = vm.pop();
  vm.push(vm.binary(instruction.name, vm.pop(), right));
}
