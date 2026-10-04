import {ManagedFault} from '../heap.js';
import {verifiedMethod} from './token-cache.js';
import {prepareValueReceiver} from './value-calls.js';
import {createValue} from './value-types.js';
import {boxValue} from './boxing.js';
import {invokeIntrinsic} from './intrinsics.js';
import {framePool} from './frame-pool.js';
import {instantiatedMethod} from './generics.js';
import {SUSPENDED} from '../suspension.js';
export {constrainedInt32Plan, constrainedPrimitivePlan, constrainedObjectPlan,
  constrainedReferenceObjectPlan, requireConstrainedObjectBound} from './object-dispatch.js';

/** Enter the exact override on its original byref, or root a copied box for the inherited intrinsic. */
export function invokeConstrainedObject(vm, caller, descriptor, {table, plan, receiver, current}) {
  const genericIdentity = table.typeArguments.length ? table.name : null;
  if (plan.target) {
    if (!verifiedMethod(vm, plan.target)) {
      throw new ManagedFault('NotSupportedException', `Unverified constrained Object.${descriptor.name} implementation`);
    }
    prepareValueReceiver(vm, instantiatedMethod(vm, plan.target, genericIdentity), receiver);
  } else {
    if (current.readonly) throw new ManagedFault('NotSupportedException', 'Readonly constrained value calls are not implemented');
    if (current.value === undefined) throw new ManagedFault('InvalidProgramException', 'Constrained receiver is uninitialized');
    createValue(vm, table, current.value);
  }
  if (vm.ensureInitialized(table.definitionToken, 'instance-method', genericIdentity)) {
    caller.pc--;
    return true;
  }
  const pool = framePool(vm);
  const args = pool.arguments(caller.stack, descriptor.signature.parameters.length + 1);
  try {
    // A popped interior address can be its owner's sole remaining root.
    vm.heap.withRoots(args, () => {
      if (plan.target) vm.call(plan.target, args, {genericIdentity});
      else {
        const box = boxValue(vm, current.value, table);
        vm.heap.withRoots([box], () => {
          args[0] = box;
          const result = invokeIntrinsic(vm, descriptor, args, true);
          if (result !== SUSPENDED) caller.stack.push(result);
        });
      }
    });
  } finally {
    pool.releaseArguments(args);
  }
  return true;
}
