import {
  argumentHandle,
  typedReference,
  typedReferenceValue,
  typedReferenceType
} from '../varargs.js';

export const handlers = new Map([
  ['arglist', (vm, frame) => vm.push(argumentHandle(vm, frame))],
  ['mkrefany', (vm, frame, instruction) => vm.push(typedReference(vm, vm.pop(), instruction.operand))],
  ['refanyval', (vm, frame, instruction) => vm.push(typedReferenceValue(vm, vm.pop(), instruction.operand))],
  ['refanytype', vm => vm.push(typedReferenceType(vm, vm.pop()))]
]);
