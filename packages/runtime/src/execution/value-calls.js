import {asyncStateMachine} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {createValue, isAggregateType} from './value-types.js';
import {inspectManagedAddress} from './managed-address.js';
import {boxValue, unboxValue} from './boxing.js';

const unsupported = () => {
  throw new ManagedFault('NotSupportedException', 'Only nongeneric direct user-struct calls are implemented');
};

/** Value receivers keep their own address; virtual/reference dispatch must not inspect them as objects. */
export function userValueCallType(vm, method, opcode = 'call') {
  if (method.signature.isStatic) return null;
  const table = vm.typeSystem.table(method.genericIdentity ?? method.ownerInstance ?? method.ownerToken);
  if (!table.flags.valueType || !vm.typeSystem.types.has(table.definitionToken)) return null;
  const machine = asyncStateMachine(vm.inspector, table.name);
  if (!isAggregateType(table) || !machine && (table.genericArity || table.typeArguments.length) || table.containsGenericParameters ||
      method.signature.genericArity || method.methodArguments?.length ||
      method.signature.returnType.endsWith('&') || !['call', 'newobj'].includes(opcode)) unsupported();
  return table;
}

/** Validate without masking expired, foreign, readonly or differently typed storage. */
export function prepareValueReceiver(vm, method, receiver) {
  const table = userValueCallType(vm, method);
  if (!table) return;
  if (!receiver?.byref || !Object.isFrozen(receiver)) {
    throw new ManagedFault('InvalidProgramException', 'A user-struct instance call requires an owned managed address');
  }
  const current = inspectManagedAddress(vm, receiver);
  if (current.readonly) throw new ManagedFault('NotSupportedException', 'Readonly user-struct instance calls are not implemented');
  if (vm.typeSystem.table(current.type) !== table) {
    throw new ManagedFault('InvalidProgramException', 'User-struct receiver storage has a different declared type');
  }
  if (current.value === undefined) {
    if (method.name !== '.ctor' || receiver.kind !== 'local' || receiver.path.length) {
      throw new ManagedFault('InvalidProgramException', 'User-struct receiver is uninitialized');
    }
    vm.dereference(receiver, true, createValue(vm, table));
  } else {
    // Reuse storage admission for layouts, nested fields, frozen ownership and reference rejection.
    createValue(vm, table, current.value);
  }
}

/** A temporary managed box provides stable constructor storage across calls, GC and snapshots. */
export function constructUserValue(vm, descriptor, table, args) {
  const reference = boxValue(vm, createValue(vm, table), table);
  vm.heap.withRoots([reference], () => {
    args.unshift(vm.address('box', 0, reference));
    vm.call(descriptor.resolvedToken ?? descriptor.token, args, {returnObject: reference, valueConstructor: true});
  });
}

/** Copy before retiring the constructor frame, whose ordinary roots own its temporary box. */
export function valueCallResult(vm, frame, result) {
  return frame.valueConstructor
    ? unboxValue(vm, frame.returnObject, frame.method.ownerToken)
    : frame.returnObject ?? result;
}
