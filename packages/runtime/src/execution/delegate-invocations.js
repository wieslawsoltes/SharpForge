import {
  managedDelegateSignature
} from '@sharpforge/cil';
import {
  ManagedFault,
  isReference
} from '../heap.js';
import {
  SUSPENDED
} from '../suspension.js';
import {
  boundDelegateCall,
  boundDelegatesEqual
} from './delegate-targets.js';

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

export function delegatesEqual(vm, left, right) {
  if (left === null || right === null) return left === right;
  if (!isReference(left) || !isReference(right) || vm.heap.get(left).kind !== 'delegate' ||
    vm.heap.get(right).kind !== 'delegate') return false;
  const first = delegateEntries(vm, left),
    second = delegateEntries(vm, right);
  return first.length === second.length && first.every((entry, index) => boundDelegatesEqual(vm, entry, second[index]));
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
      invocationList: list
    }, 'delegate'));
  });
}

export function combineDelegates(vm, left, right) {
  if (left === null) return right;
  if (right === null) return left;
  const type = record(vm, left).methodTable;
  if (record(vm, right).methodTable !== type) throw new ManagedFault('ArgumentException', 'Cannot combine different delegate types');
  return fromEntries(vm, type.name, [...delegateEntries(vm, left), ...delegateEntries(vm, right)]);
}

export function removeDelegate(vm, source, value, all = false) {
  if (source === null || value === null) return source;
  const type = record(vm, source).methodTable;
  if (record(vm, value).methodTable !== type) throw new ManagedFault('ArgumentException', 'Cannot remove a different delegate type');
  const entries = delegateEntries(vm, source),
    remove = delegateEntries(vm, value);
  let changed = false;
  do {
    let at = -1;
    for (let index = entries.length - remove.length; index >= 0; index--) {
      if (remove.every((entry, offset) => boundDelegatesEqual(vm, entries[index + offset], entry))) {
        at = index;
        break;
      }
    }
    if (at < 0) break;
    entries.splice(at, remove.length);
    changed = true;
  } while (all);
  return changed ? fromEntries(vm, type.name, entries) : source;
}

/** The captured list owns inputs across yields; each element uses canonical delegate binding. */
export function delegateInvocation(vm, reference, args) {
  const signature = managedDelegateSignature(vm.inspector, record(vm, reference).type);
  if (!signature || args.length !== signature.parameters.length) {
    throw new ManagedFault('ArgumentException', 'Delegate argument count mismatch');
  }
  return {
    entries: delegateEntries(vm, reference),
    args: [...args],
    next: 0,
    signature
  };
}

export function nextDelegateCall(vm, continuation) {
  const entry = continuation.entries[continuation.next++];
  return {
    ...boundDelegateCall(vm, entry, continuation.args),
    extra: {
      delegateContinuation: continuation
    }
  };
}

export function invokeDelegate(vm, reference, args) {
  const continuation = delegateInvocation(vm, reference, args);
  return vm.heap.withRoots([...continuation.entries, ...continuation.args], () => {
    const call = nextDelegateCall(vm, continuation);
    vm.call(call.method, call.arguments, call.extra);
    return SUSPENDED;
  });
}

/** Only the final delegate result reaches the original caller. */
export function continueDelegate(vm, frame, result, continuation = frame.delegateContinuation) {
  if (!continuation || continuation.next >= continuation.entries.length) return {
    continued: false,
    result
  };
  vm.heap.withRoots([...continuation.entries, ...continuation.args], () => {
    const call = nextDelegateCall(vm, continuation);
    vm.call(call.method, call.arguments, call.extra);
  });
  return {
    continued: true,
    result: null
  };
}

export function invokeDelegateOperation(vm, descriptor, args) {
  switch (descriptor.name) {
    case 'Combine': {
      if (args.length === 2) return combineDelegates(vm, args[0], args[1]);
      let result = null;
      if (args[0] !== null)
        for (const value of vm.heap.get(args[0]).data) {
          result = vm.heap.withRoots([args[0], result, value], () => combineDelegates(vm, result, value));
        }
      return result;
    }
    case 'Remove':
    case 'RemoveAll':
      return removeDelegate(vm, args[0], args[1], descriptor.name === 'RemoveAll');
    case 'Equals':
    case 'op_Equality':
      return delegatesEqual(vm, args[0], args[1]) ? 1 : 0;
    case 'op_Inequality':
      return delegatesEqual(vm, args[0], args[1]) ? 0 : 1;
    case 'GetInvocationList':
      return vm.heap.allocate('array', 'System.Delegate[]', delegateEntries(vm, args[0]));
    default:
      return invokeDelegate(vm, args[0], args.slice(1));
  }
}
