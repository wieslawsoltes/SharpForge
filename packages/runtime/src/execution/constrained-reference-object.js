import {ManagedFault} from '../heap.js';
import {constrainedReferenceObjectPlan} from './constrained-object.js';
import {verifiedMethod} from './token-cache.js';
import {selectedCallOwner} from './generic-calls.js';
import {invokeIntrinsic} from './intrinsics.js';

/** Arguments already contain the live, validated and pinned reference; never copy or box it. */
export function invokeConstrainedReferenceObject(vm, caller, descriptor, args, constraint) {
  if (!constraint || !constrainedReferenceObjectPlan(vm, constraint, descriptor)) return false;
  const receiver = args[0];
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Null constrained Object receiver');
  const actual = vm.heap.get(receiver).methodTable;
  const plan = constrainedReferenceObjectPlan(vm, actual, descriptor);
  if (!plan) throw new ManagedFault('NotSupportedException', 'Unsupported constrained Object reference hierarchy');
  if (plan.target) {
    if (!verifiedMethod(vm, plan.target)) throw new ManagedFault('NotSupportedException', 'Unverified constrained Object.ToString override');
    const genericIdentity = selectedCallOwner(vm, plan.target, receiver, null);
    vm.call(plan.target, args, {genericIdentity});
  } else caller.stack.push(invokeIntrinsic(vm, descriptor, args, true));
  return true;
}
