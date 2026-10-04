import {ConstrainedObjectProfile, ConstrainedReferenceObjectProfile} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {verifiedMethod} from './token-cache.js';
import {prepareValueReceiver} from './value-calls.js';
import {createValue, isAggregateType} from './value-types.js';
import {boxValue} from './boxing.js';
import {invokeIntrinsic} from './intrinsics.js';
import {framePool} from './frame-pool.js';

const profiles = new WeakMap();

/** Epoch-scoped metadata plans contain no managed receivers or handles. */
function profileFor(vm) {
  const epoch = executionCodeState(vm);
  let profile = profiles.get(epoch);
  if (!profile) {
    profile = {objects: new ConstrainedObjectProfile(vm.inspector), references: null};
    profiles.set(epoch, profile);
  }
  return profile;
}

export function constrainedInt32Plan(vm, token, descriptor) {
  return profileFor(vm).objects.int32(token, descriptor);
}

export function constrainedPrimitivePlan(vm, token, descriptor) {
  return profileFor(vm).objects.primitive(token, descriptor);
}

export function constrainedObjectPlan(vm, table, descriptor) {
  if (!isAggregateType(table) || table.flags.nullable || table.genericArity ||
      table.typeArguments.length || table.containsGenericParameters) return null;
  return profileFor(vm).objects.select(table.definitionToken, descriptor);
}

export function constrainedReferenceObjectPlan(vm, table, descriptor) {
  if (table.flags.valueType || table.flags.interface || table.genericArity ||
      table.typeArguments.length || table.containsGenericParameters) return null;
  const profile = profileFor(vm);
  if (!profile.objects.declaration(descriptor)) return null;
  profile.references ??= new ConstrainedReferenceObjectProfile(vm.inspector, profile.objects, vm.typeSystem.dispatch);
  return profile.references.select(table.definitionToken, descriptor);
}

/** Enter the exact override on its original byref, or root a copied box for the inherited intrinsic. */
export function invokeConstrainedObject(vm, caller, descriptor, {table, plan, receiver, current}) {
  if (plan.target) {
    if (!verifiedMethod(vm, plan.target)) {
      throw new ManagedFault('NotSupportedException', 'Unverified constrained Object.ToString implementation');
    }
    prepareValueReceiver(vm, vm.inspector.getMethod(plan.target), receiver);
  } else {
    if (current.readonly) throw new ManagedFault('NotSupportedException', 'Readonly constrained value calls are not implemented');
    if (current.value === undefined) throw new ManagedFault('InvalidProgramException', 'Constrained receiver is uninitialized');
    createValue(vm, table, current.value);
  }
  if (vm.ensureInitialized(table.definitionToken, 'instance-method')) {
    caller.pc--;
    return true;
  }
  const pool = framePool(vm);
  const args = pool.arguments(caller.stack, 1);
  try {
    // A popped interior address can be its owner's sole remaining root.
    vm.heap.withRoots([receiver.owner], () => {
      if (plan.target) vm.call(plan.target, args);
      else {
        const box = boxValue(vm, current.value, table);
        vm.heap.withRoots([box], () => {
          args[0] = box;
          caller.stack.push(invokeIntrinsic(vm, descriptor, args, true));
        });
      }
    });
  } finally {
    pool.releaseArguments(args);
  }
  return true;
}
