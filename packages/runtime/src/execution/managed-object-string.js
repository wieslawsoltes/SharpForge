import {ConstrainedObjectProfile, ConstrainedReferenceObjectProfile, CilError} from '@sharpforge/cil';
import {isReference, ManagedFault} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {invokeFrameworkObjectToString} from './framework-object-string.js';
import {invokeManagedMethod, SYNCHRONOUS_CALL_CANCELED} from './synchronous-call.js';
import {sourceObjectStringTarget} from './source-object-string.js';
import {selectedCallOwner} from './generic-calls.js';

const profiles = new WeakMap();
const unhandled = Object.freeze({handled: false});
const canceled = Object.freeze({handled: true, value: null, canceled: true});

function profileFor(vm) {
  const epoch = executionCodeState(vm);
  let profile = profiles.get(epoch);
  if (!profile) {
    const objects = new ConstrainedObjectProfile(vm.inspector);
    profile = {objects, references: new ConstrainedReferenceObjectProfile(vm.inspector, objects, vm.typeSystem.dispatch)};
    profiles.set(epoch, profile);
  }
  return profile;
}

function cilTarget(vm, record) {
  const table = record.methodTable;
  if (!vm.typeSystem.types.has(table.definitionToken)) return null;
  const profile = profileFor(vm);
  const plan = table.flags.valueType ? profile.objects.valuePlan(table.definitionToken)
    : profile.references.plan(table.definitionToken);
  if (plan) return plan.target;
  // Unsupported layouts/generic owners without any possible override still retain the old type-name fallback.
  for (let current = table; current; current = current.base) {
    const definition = vm.typeSystem.types.get(current.definitionToken);
    if (definition?.methods.some(method => profile.objects.virtualMethod(method))) {
      throw new ManagedFault('NotSupportedException', 'Object.ToString callback requires an admitted nongeneric managed hierarchy or struct');
    }
  }
  return null;
}

function receiverFor(vm, record, receiver) {
  if (record.kind !== 'box') return receiver;
  // Box interior identity belongs to its heap owner, so it remains valid with no active caller frame.
  return Object.freeze({byref: true, vmOwner: vm.snapshotOwner, kind: 'box', index: 0, owner: receiver,
    frameId: vm.top?.id ?? 0, path: Object.freeze([])});
}

/** Resolve Object's true virtual slot, then execute its managed body under the synchronous call boundary. */
export function invokeObjectToString(platform, receiver) {
  const framework = invokeFrameworkObjectToString(platform, receiver);
  if (framework.handled || !isReference(receiver)) return framework;
  const vm = platform.vm, record = platform.heap.get(receiver);
  if (!vm || (record.kind !== 'object' && record.kind !== 'box')) return unhandled;
  let target;
  try { target = vm.inspector ? cilTarget(vm, record) : sourceObjectStringTarget(vm, record.methodTable); }
  catch (error) {
    if (error instanceof CilError) throw new ManagedFault('NotSupportedException', error.message);
    throw error;
  }
  if (target === null) return unhandled;
  const value = invokeManagedMethod(platform, target, receiverFor(vm, record, receiver), [], {
    maxInstructions: vm.options.maxSynchronousInstructions ?? 20000,
    roots: [receiver],
    ...(vm.inspector && record.kind !== 'box' ? {genericIdentity: selectedCallOwner(vm, target, receiver, null)} : {})
  });
  if (value === SYNCHRONOUS_CALL_CANCELED) return canceled;
  if (value !== null && (!isReference(value) || platform.heap.get(value).kind !== 'string')) {
    throw new ManagedFault('InvalidProgramException', 'Object.ToString override did not return a managed string or null');
  }
  return {handled: true, value};
}
