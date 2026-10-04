import {ManagedFault} from '../heap.js';
import {validateMemoryPointer} from './raw-memory.js';
import {sameMemoryAllocation} from './memory-allocation-identity.js';
import {isNativeNull} from './native-int.js';

const nullPointer = (vm, value) => value === null || value === 0 || value === 0n || isNativeNull(value, vm.options);

/** Pointer truth and equality retain capability lifetime checks instead of coercing host objects. */
export function pointerTruth(vm, value) {
  if (value?.memoryPointer) validateMemoryPointer(vm, value);
  return !nullPointer(vm, value);
}

export function comparePointers(vm, left, right, operation) {
  if (left?.memoryPointer) validateMemoryPointer(vm, left);
  if (right?.memoryPointer) validateMemoryPointer(vm, right);
  const both = left?.memoryPointer && right?.memoryPointer;
  const equal = both ? sameMemoryAllocation(left, right) && left.index === right.index
    : nullPointer(vm, left) && nullPointer(vm, right);
  if (operation === 'eq') return equal;
  if (operation === 'ne') return !equal;
  if (!both || !sameMemoryAllocation(left, right)) {
    throw new ManagedFault('InvalidProgramException', 'Pointer ordering requires addresses in the same allocation');
  }
  if (operation === 'lt') return left.index < right.index;
  if (operation === 'le') return left.index <= right.index;
  if (operation === 'gt') return left.index > right.index;
  if (operation === 'ge') return left.index >= right.index;
  throw new ManagedFault('InvalidProgramException', 'Unsupported pointer comparison');
}
