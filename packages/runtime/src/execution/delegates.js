import {managedDelegateSignature, callSignatureKey} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {SUSPENDED} from './suspension.js';

function equalRef(left, right) {
  return left === right || isReference(left) && isReference(right) && left.h === right.h && left.g === right.g &&
    (left.heapOwner === undefined || right.heapOwner === undefined || left.heapOwner === right.heapOwner);
}

function record(vm, reference) {
  const value = vm.heap.get(reference);
  if (value.kind !== 'delegate') throw new ManagedFault('ArgumentException', 'A managed delegate is required');
  return value;
}

export function delegateEntries(vm, reference) {
  if (reference === null) return [];
  record(vm, reference);
  const list = vm.platform.get(reference, 'invocationList');
  return list ? [...vm.heap.get(list).data] : [reference];
}

function pointerEquals(vm, left, right) {
  if (left === right) return true;
  if (!left || !right || left.vmOwner !== right.vmOwner) return false;
  const first = left.descriptor;
  const second = right.descriptor;
  if (first.resolvedToken !== second.resolvedToken) return false;
  if (!first.resolvedToken && (first.owner !== second.owner || first.name !== second.name ||
      callSignatureKey(first.signature) !== callSignatureKey(second.signature))) return false;
  const firstOwner = first.ownerInstance ? vm.typeSystem.table(first.ownerInstance) : null;
  const secondOwner = second.ownerInstance ? vm.typeSystem.table(second.ownerInstance) : null;
  if (firstOwner !== secondOwner) return false;
  const firstArguments = first.methodArguments ?? [];
  const secondArguments = second.methodArguments ?? [];
  return firstArguments.length === secondArguments.length && firstArguments.every((type, index) =>
    vm.typeSystem.table(type) === vm.typeSystem.table(secondArguments[index]));
}

function entryEquals(vm, left, right) {
  if (equalRef(left, right)) return true;
  if (record(vm, left).methodTable !== record(vm, right).methodTable ||
      vm.platform.get(left, 'mode') !== vm.platform.get(right, 'mode') ||
      !equalRef(vm.platform.get(left, 'receiver'), vm.platform.get(right, 'receiver'))) return false;
  const first = vm.platform.get(left, 'pointer');
  const second = vm.platform.get(right, 'pointer');
  return first || second ? pointerEquals(vm, first, second) :
    vm.platform.get(left, 'method') === vm.platform.get(right, 'method');
}

export function delegatesEqual(vm, left, right) {
  if (left === null || right === null) return left === right;
  const first = delegateEntries(vm, left);
  const second = delegateEntries(vm, right);
  return first.length === second.length && first.every((entry, index) => entryEquals(vm, entry, second[index]));
}

function typeCompatible(vm, source, target) {
  const first = vm.typeSystem.table(source);
  const second = vm.typeSystem.table(target);
  return first === second || !first.flags.valueType && !second.flags.valueType &&
    vm.typeSystem.castCache.isAssignableFrom(second, first);
}

function boundReceiverMatches(vm, receiver, type) {
  const table = vm.typeSystem.table(type);
  if (table.flags.byRef || table.flags.pointer || table.flags.valueType) return false;
  return receiver === null || vm.matches(receiver, type);
}

/** Bind by signature arity so a closed static delegate can bind a null first argument. */
export function constructDelegate(vm, type, receiver, pointer) {
  const signature = managedDelegateSignature(vm.inspector, type);
  if (!signature || !pointer?.methodPointer || pointer.vmOwner !== vm.snapshotOwner) {
    throw new ManagedFault('ArgumentException', 'Delegate construction requires a verified managed function pointer');
  }
  const method = pointer.descriptor.signature;
  const parameters = [...method.parameters];
  let mode;
  if (method.isStatic) {
    const closed = parameters.length === signature.parameters.length + 1;
    mode = closed ? 'closed-static' : 'static';
    if (closed ? !boundReceiverMatches(vm, receiver, parameters.shift()) : receiver !== null) {
      throw new ManagedFault('ArgumentException', 'Closed static delegate receiver mismatch');
    }
  } else if (parameters.length + 1 === signature.parameters.length && receiver === null) {
    mode = 'open-instance';
    parameters.unshift(pointer.descriptor.ownerInstance ?? pointer.descriptor.owner);
  } else {
    mode = 'closed-instance';
    if (receiver === null || !vm.matches(receiver, pointer.descriptor.ownerInstance ?? pointer.descriptor.owner)) {
      throw new ManagedFault('ArgumentException', 'Delegate receiver type mismatch');
    }
  }
  const argumentsMatch = parameters.length === signature.parameters.length && parameters.every((parameter, index) =>
    parameter === signature.parameters[index] || !parameter.endsWith('&') && !signature.parameters[index].endsWith('&') &&
    typeCompatible(vm, signature.parameters[index], parameter));
  const resultMatches = method.returnType === signature.returnType || method.returnType !== 'void' &&
    signature.returnType !== 'void' && typeCompatible(vm, method.returnType, signature.returnType);
  if (!argumentsMatch || !resultMatches) throw new ManagedFault('ArgumentException', 'Delegate signature does not match the method target');
  return vm.platform.make(type, {method: pointer.descriptor.resolvedToken ?? pointer.token, receiver, pointer, mode}, 'delegate');
}

function fromEntries(vm, type, entries) {
  if (!entries.length) return null;
  if (entries.length === 1) return entries[0];
  if (entries.length > (vm.options.maxDelegateTargets ?? 4096)) {
    throw new ManagedFault('ExecutionLimitException', 'Delegate invocation list limit exceeded');
  }
  return vm.heap.withRoots(entries, () => {
    const list = vm.heap.allocate('array', 'System.Delegate[]', entries);
    return vm.heap.withRoots([list], () => vm.platform.make(type, {
      method: vm.platform.get(entries[0], 'method'), receiver: vm.platform.get(entries[0], 'receiver'), invocationList: list
    }, 'delegate'));
  });
}

export function combineDelegates(vm, left, right) {
  if (left === null) return right;
  if (right === null) return left;
  const type = record(vm, left).type;
  if (record(vm, right).type !== type) throw new ManagedFault('ArgumentException', 'Cannot combine different delegate types');
  return fromEntries(vm, type, [...delegateEntries(vm, left), ...delegateEntries(vm, right)]);
}

export function removeDelegate(vm, source, value, all = false) {
  if (source === null || value === null) return source;
  const type = record(vm, source).type;
  if (record(vm, value).type !== type) throw new ManagedFault('ArgumentException', 'Cannot remove a different delegate type');
  const entries = delegateEntries(vm, source);
  const remove = delegateEntries(vm, value);
  let changed = false;
  do {
    let at = -1;
    for (let index = entries.length - remove.length; index >= 0; index--) {
      if (remove.every((entry, offset) => entryEquals(vm, entries[index + offset], entry))) { at = index; break; }
    }
    if (at < 0) break;
    entries.splice(at, remove.length);
    changed = true;
  } while (all);
  return changed ? fromEntries(vm, type, entries) : source;
}

function invokeEntry(vm, entry, args, continuation) {
  const pointer = vm.platform.get(entry, 'pointer');
  const receiver = vm.platform.get(entry, 'receiver');
  const mode = vm.platform.get(entry, 'mode');
  if (!pointer) {
    // Source-compiler/platform delegates can use verified method tokens directly.
    const token = vm.platform.get(entry, 'method');
    const method = vm.inspector.getMethod(token);
    vm.call(token, method.signature.isStatic ? args : [receiver, ...args], {delegateContinuation: continuation});
    return SUSPENDED;
  }
  const values = mode === 'closed-instance' || mode === 'closed-static' ? [receiver, ...args] : [...args];
  return vm.invokeFunctionPointer(pointer, values, {delegateContinuation: continuation});
}

export function invokeDelegate(vm, reference, args) {
  const type = record(vm, reference).type;
  const signature = managedDelegateSignature(vm.inspector, type);
  if (!signature || args.length !== signature.parameters.length) {
    throw new ManagedFault('ArgumentException', 'Delegate argument count mismatch');
  }
  const continuation = {delegates: delegateEntries(vm, reference), args: [...args], next: 0, signature};
  return resumeDelegate(vm, continuation);
}

function resumeDelegate(vm, continuation) {
  let result = null;
  return vm.heap.withRoots([...continuation.delegates, ...continuation.args], () => {
    while (continuation.next < continuation.delegates.length) {
      const entry = continuation.delegates[continuation.next++];
      result = invokeEntry(vm, entry, continuation.args, continuation);
      if (result === SUSPENDED) return result;
    }
    return result;
  });
}

/** Return handling resumes multicast entries; only the final return reaches the caller. */
export function continueDelegate(vm, frame, result) {
  const continuation = frame.delegateContinuation;
  if (!continuation || continuation.next >= continuation.delegates.length) return {continued: false, result};
  const next = resumeDelegate(vm, continuation);
  return next === SUSPENDED ? {continued: true, result: null} : {continued: false, result: next};
}

function combineArray(vm, array) {
  if (array === null) return null;
  return vm.heap.withRoots([array], () => {
    let result = null;
    for (const value of vm.heap.get(array).data) {
      result = combineDelegates(vm, result, value);
      if (result) vm.heap.pins.push(result);
    }
    return result;
  });
}

export function invokeDelegateOperation(vm, descriptor, args) {
  switch (descriptor.name) {
    case 'Invoke':
      if (args[0] !== null && !vm.matches(args[0], descriptor.ownerInstance ?? descriptor.owner)) {
        throw new ManagedFault('InvalidProgramException', 'Delegate invocation receiver type mismatch');
      }
      return invokeDelegate(vm, args[0], args.slice(1));
    case 'Combine': return args.length === 2 ? combineDelegates(vm, ...args) : combineArray(vm, args[0]);
    case 'Remove': case 'RemoveAll': return removeDelegate(vm, args[0], args[1], descriptor.name === 'RemoveAll');
    case 'Equals':
      return args[1] !== null && isReference(args[1]) && vm.heap.get(args[1]).kind === 'delegate' &&
        delegatesEqual(vm, args[0], args[1]) ? 1 : 0;
    case 'op_Equality': return delegatesEqual(vm, args[0], args[1]) ? 1 : 0;
    case 'op_Inequality': return delegatesEqual(vm, args[0], args[1]) ? 0 : 1;
    case 'GetInvocationList': return vm.heap.allocate('array', 'System.Delegate[]', delegateEntries(vm, args[0]));
    default: throw new ManagedFault('MissingMethodException', 'Unknown managed delegate operation');
  }
}
