import {ManagedFault} from '../heap.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';

/** Format a type-checked owned integer address without boxing or changing its storage. */
export function invokeConstrainedPrimitive(vm, caller, receiver, current, plan) {
  if (current.readonly) throw new ManagedFault('NotSupportedException', 'Readonly constrained integer calls are not implemented');
  if (!scalarStorageGuard(plan.format)(current.value)) {
    throw new ManagedFault('InvalidProgramException', 'Constrained integer ToString requires initialized canonical storage');
  }
  // Keep the address and its owner rooted through formatting/allocation callbacks. Failure
  // leaves the operand in place; the one-input/one-result replacement cannot grow the stack.
  const result = vm.heap.withRoots([receiver.owner], () => vm.heap.string(vm.format(current.value, plan.format)));
  caller.stack[caller.stack.length - 1] = result;
  return true;
}
