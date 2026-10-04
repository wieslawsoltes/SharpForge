import {ManagedFault} from '../heap.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';

const int32 = scalarStorageGuard('int');

/** Format an already type-checked owned Int32 address without boxing or changing its storage. */
export function invokeConstrainedInt32(vm, caller, receiver, current) {
  if (current.readonly) throw new ManagedFault('NotSupportedException', 'Readonly constrained Int32 calls are not implemented');
  if (!int32(current.value)) {
    throw new ManagedFault('InvalidProgramException', 'Constrained Int32 requires initialized canonical Int32 storage');
  }
  // Keep the address and its owner rooted through formatting/allocation callbacks. Failure
  // leaves the operand in place; the one-input/one-result replacement cannot grow the stack.
  const result = vm.heap.withRoots([receiver.owner], () => vm.heap.string(vm.format(current.value, 'int')));
  caller.stack[caller.stack.length - 1] = result;
  return true;
}
