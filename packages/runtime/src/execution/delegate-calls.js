import {ManagedFault} from './managed-fault.js';
import {castCacheFor} from './casting.js';
import {invokeDelegateOperation} from './delegate-invocations.js';
import {constructBoundDelegate, delegateRecord} from './delegate-targets.js';

/** Keep call adaptation above binding and invocation-list helpers in the dependency graph. */
export function invokeBoundDelegate(vm, descriptor, args, constructing) {
  if (constructing) return constructBoundDelegate(vm, descriptor.ownerInstance ?? descriptor.owner, args[0], args[1]);
  if (descriptor.name === '.ctor') throw new ManagedFault('NotSupportedException', 'Delegate construction requires newobj');
  if (descriptor.name !== 'Invoke') return invokeDelegateOperation(vm, descriptor, args);
  delegateRecord(vm, args[0]);
  const expected = vm.heap.methodTables.get(descriptor.ownerInstance ?? descriptor.owner);
  if (!castCacheFor(vm.heap.methodTables).isAssignableFrom(expected, vm.heap.get(args[0]).methodTable)) {
    throw new ManagedFault('ArgumentException', 'Delegate invocation receiver type mismatch');
  }
  return vm.scheduler.callDelegate(args[0], args.slice(1));
}
