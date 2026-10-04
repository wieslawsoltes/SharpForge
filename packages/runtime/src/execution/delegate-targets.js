import {invokeDelegateOperation} from './delegate-invocations.js';
import {createMethodPointer} from './method-pointers.js';
import {managedDelegateSignature} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {castCacheFor} from './casting.js';
import {cachedMetadataToken,verifiedMethod} from './token-cache.js';

const fault = message => new ManagedFault('ArgumentException', message);
const equalReference = (left, right) => left === right || isReference(left) && isReference(right) &&
  left.h === right.h && left.g === right.g;

function targetMethod(vm, token) {
  if (!Number.isInteger(token) || !verifiedMethod(vm, token)) throw fault('Unverified delegate target');
  return vm.inspector.getMethod(token);
}

/** Opaque VM-owned pointer; MemberRef and MethodDef references share the resolved identity. */
export function delegateMethodPointer(vm, token) {
  const descriptor = cachedMetadataToken(vm, token);
  const target = descriptor.resolvedToken ?? descriptor.token;
  targetMethod(vm, target);
  return createMethodPointer(vm, target);
}

function compatible(vm, source, target) {
  const registry = vm.heap.methodTables;
  const first = registry.get(source), second = registry.get(target);
  return first === second || !first.flags.valueType && !second.flags.valueType &&
    !first.flags.byRef && !second.flags.byRef && !first.flags.pointer && !second.flags.pointer &&
    castCacheFor(registry).isAssignableFrom(second, first);
}

function receiverMatches(vm, receiver, type, allowNull = false) {
  const target = vm.heap.methodTables.get(type);
  if (target.flags.byRef || target.flags.pointer || target.flags.valueType) return false;
  if (receiver === null) return allowNull;
  return isReference(receiver) && castCacheFor(vm.heap.methodTables).isAssignableFrom(target, vm.heap.get(receiver).methodTable);
}

/** Bind by signature arity, including a null first argument of a closed static method. */
export function constructBoundDelegate(vm, type, receiver, pointer) {
  const signature = managedDelegateSignature(vm.inspector, type);
  if (!signature || !pointer?.methodPointer || pointer.vmOwner !== vm.snapshotOwner) throw fault('Verified managed delegate pointer required');
  const method = targetMethod(vm, pointer.token);
  const parameters = [...method.signature.parameters];
  let mode;
  if (method.signature.isStatic) {
    const closed = parameters.length === signature.parameters.length + 1;
    mode = closed ? 'closed-static' : 'static';
    if (closed ? !receiverMatches(vm, receiver, parameters.shift(), true) : receiver !== null) throw fault('Static delegate target mismatch');
  } else if (receiver === null && parameters.length + 1 === signature.parameters.length) {
    mode = 'open-instance';
    parameters.unshift(method.owner);
  } else {
    mode = 'closed-instance';
    if (!receiverMatches(vm, receiver, method.owner)) throw fault('Instance delegate target mismatch');
  }
  const argumentsMatch = parameters.length === signature.parameters.length &&
    parameters.every((parameter, index) => compatible(vm, signature.parameters[index], parameter));
  const resultMatches = compatible(vm, method.signature.returnType, signature.returnType);
  if (!argumentsMatch || !resultMatches) throw fault('Delegate signature does not match target');
  return vm.platform.make(type, {method: pointer.token, receiver, mode}, 'delegate');
}

function delegateRecord(vm, reference) {
  const record = vm.heap.get(reference);
  if (record.kind !== 'delegate') throw fault('Managed delegate required');
  return record;
}

function bindingMode(vm, reference, method) {
  const mode = vm.platform.get(reference, 'mode');
  if (mode !== null) return mode;
  // Existing source/platform records predate explicit binding modes.
  const target = vm.inspector ? vm.inspector.getMethod(method) : vm.image.methods[method];
  const isStatic = vm.inspector ? target.signature.isStatic : target.isStatic;
  if (!isStatic) return 'closed-instance';
  const signature = managedDelegateSignature(vm.inspector, vm.heap.get(reference).type);
  const parameters = vm.inspector ? target.signature.parameters : target.parameters;
  return parameters.length === signature.parameters.length + 1 ? 'closed-static' : 'static';
}

/** Equality uses canonical method, delegate type, target identity and binding mode. */
export function boundDelegatesEqual(vm, left, right) {
  if (left === null || right === null) return left === right;
  if (!isReference(left) || !isReference(right)) return false;
  const first = vm.heap.get(left), second = vm.heap.get(right);
  if (first.kind !== 'delegate' || second.kind !== 'delegate') return false;
  const firstMethod = vm.platform.get(left, 'method'), secondMethod = vm.platform.get(right, 'method');
  return first.methodTable === second.methodTable && firstMethod === secondMethod &&
    bindingMode(vm, left, firstMethod) === bindingMode(vm, right, secondMethod) &&
    equalReference(vm.platform.get(left, 'receiver'), vm.platform.get(right, 'receiver'));
}

/** Prepare arguments identically for an immediate call and a scheduled delegate context. */
export function boundDelegateCall(vm, reference, args) {
  const record = delegateRecord(vm, reference);
  const signature = managedDelegateSignature(vm.inspector, record.type);
  if (!signature || args.length !== signature.parameters.length) throw fault('Delegate argument count mismatch');
  const method = vm.platform.get(reference, 'method');
  const receiver = vm.platform.get(reference, 'receiver');
  const mode = bindingMode(vm, reference, method);
  if (!['static', 'closed-static', 'open-instance', 'closed-instance'].includes(mode)) throw fault('Unknown delegate binding mode');
  return {method, arguments: mode === 'closed-static' || mode === 'closed-instance' ? [receiver, ...args] : [...args]};
}

/** Leaves ordinary calls and returns on main's existing frame/scheduler path. */
export function invokeBoundDelegate(vm, descriptor, args, constructing) {
  if (constructing) return constructBoundDelegate(vm, descriptor.ownerInstance ?? descriptor.owner, args[0], args[1]);
  if (descriptor.name === '.ctor') throw new ManagedFault('NotSupportedException', 'Delegate construction requires newobj');
  if (descriptor.name !== 'Invoke') return invokeDelegateOperation(vm, descriptor, args);
  delegateRecord(vm, args[0]);
  const expected = vm.heap.methodTables.get(descriptor.ownerInstance ?? descriptor.owner);
  if (!castCacheFor(vm.heap.methodTables).isAssignableFrom(expected, vm.heap.get(args[0]).methodTable)) {
    throw fault('Delegate invocation receiver type mismatch');
  }
  return vm.scheduler.callDelegate(args[0], args.slice(1));
}
