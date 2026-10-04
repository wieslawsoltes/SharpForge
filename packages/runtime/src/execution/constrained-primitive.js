import {ManagedFault} from '../heap.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';
import {integerHash, scalarValueEquals, objectValueRecord} from './object-scalar-values.js';

/** Format a type-checked owned integer address without boxing or changing its storage. */
export function invokeConstrainedPrimitive(vm, caller, receiver, current, {plan, descriptor}) {
  if (current.readonly) throw new ManagedFault('NotSupportedException', 'Readonly constrained integer calls are not implemented');
  if (!scalarStorageGuard(plan.format)(current.value)) {
    throw new ManagedFault('InvalidProgramException', 'Constrained integer Object call requires initialized canonical storage');
  }
  // Keep the address and its owner rooted through formatting/allocation callbacks. Failure
  // leaves the operand in place; the one-input/one-result replacement cannot grow the stack.
  let result;
  if (descriptor.name === 'ToString') {
    result = vm.heap.withRoots([receiver.owner], () => vm.heap.string(vm.format(current.value, plan.format)));
  } else if (descriptor.name === 'GetHashCode') result = integerHash(current.value);
  else {
    const other = caller.stack[caller.stack.length - 1];
    const record = other === null ? null : objectValueRecord(vm, other);
    result = Number(record?.kind === 'box' && record.methodTable === vm.typeSystem.table(plan.name) &&
      scalarValueEquals(current.value, record.data[0]));
  }
  caller.stack.length -= descriptor.signature.parameters.length;
  caller.stack[caller.stack.length - 1] = result;
  return true;
}
