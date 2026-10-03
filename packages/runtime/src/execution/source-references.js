import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {arrayAddress} from './arrays.js';
import {validatePointer, pointerType, asReadonly} from './managed-pointers.js';
import {sourceStore, sourceInputTypes, sourceCopy} from './source-storage.js';

/** Source references have the same ownership, readonly and frame lifetime checks as CIL. */
export function executeSourceReference(vm, frame, op, a, b) {
  if (op === Op.ADDRESS) {
    const kind = a & 3, readonly = !!(a & 4);
    let pointer;
    if (a & 8) {
      pointer = frame.locals[b];
      validatePointer(vm, pointer, {allowUninitialized: true});
      if (readonly) pointer = asReadonly(vm, pointer);
    } else if (kind === 3) {
      const index = vm.stack.pop(), reference = vm.stack.pop();
      pointer = arrayAddress(vm, reference, [index], {readonly});
    } else pointer = vm.address(['local', 'static', 'field'][kind], b, kind === 2 ? vm.stack.pop() : null, {readonly});
    vm.stack.push(pointer);
    return true;
  }
  if (op !== Op.LDIND && op !== Op.STIND) return false;
  const value = op === Op.STIND ? vm.stack.pop() : undefined, pointer = vm.stack.pop();
  validatePointer(vm, pointer, {write: op === Op.STIND, allowUninitialized: op === Op.STIND});
  const type = vm.image.constants[a];
  if (pointerType(vm, pointer) !== vm.heap.methodTables.get(type)) {
    throw new ManagedFault('InvalidProgramException', 'Managed reference storage type mismatch');
  }
  if (op === Op.LDIND) vm.stack.push(sourceCopy(vm, vm.dereference(pointer)));
  else vm.heap.withRoots([pointer, value], () => {
    const stored = sourceStore(vm, value, type, sourceInputTypes(vm, frame).at(-1));
    vm.dereference(pointer, true, stored);
    vm.stack.push(sourceCopy(vm, stored));
  });
  return true;
}

export function sourceReturnReference(vm, frame, value) {
  if (!value?.byref) return value;
  validatePointer(vm, value);
  if (value.frameId === (frame.filterOwnerId ?? frame.id)) {
    throw new ManagedFault('InvalidProgramException', 'A return reference cannot outlive its local frame');
  }
  return value;
}
