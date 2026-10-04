import {ManagedFault} from '../heap.js';
import {constrainedReferenceObjectPlan} from './constrained-object.js';
import {verifiedMethod} from './token-cache.js';
import {selectedCallOwner} from './generic-calls.js';
import {invokeIntrinsic} from './intrinsics.js';
import {SUSPENDED} from '../suspension.js';
import {objectOverride} from './object-dispatch.js';

/** Arguments already contain the live, validated and pinned reference; never copy or box it. */
export function invokeConstrainedReferenceObject(vm, caller, descriptor, args, constraint) {
  if (!constraint || !constrainedReferenceObjectPlan(vm, constraint, descriptor)) return false;
  const receiver = args[0];
  if (receiver === null) throw new ManagedFault('NullReferenceException', 'Null constrained Object receiver');
  const actual = vm.heap.get(receiver).methodTable;
  const target = objectOverride(vm, actual, descriptor.name);
  if (target) {
    if (!verifiedMethod(vm, target)) {
      throw new ManagedFault('NotSupportedException', `Unverified constrained Object.${descriptor.name} override`);
    }
    const genericIdentity = selectedCallOwner(vm, target, receiver, null);
    if (actual.flags.valueType) args[0] = vm.address('box', 0, receiver);
    vm.call(target, args, {genericIdentity});
  } else {
    const result = invokeIntrinsic(vm, descriptor, args, true);
    if (result !== SUSPENDED) caller.stack.push(result);
  }
  return true;
}
