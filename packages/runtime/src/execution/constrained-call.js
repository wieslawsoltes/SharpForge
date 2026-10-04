import {ManagedFault} from '../heap.js';
import {framePool} from './frame-pool.js';
import {inspectManagedAddress} from './managed-address.js';
import {prepareValueReceiver} from './value-calls.js';
import {requireValueInterfaceTarget} from './value-dispatch.js';
import {cachedTypeName, verifiedMethod} from './token-cache.js';
import {resolveCallType} from './generic-calls.js';
import {constrainedPrimitivePlan, constrainedObjectPlan, constrainedReferenceObjectPlan,
  invokeConstrainedObject} from './constrained-object.js';
import {requireGenericStructArgument} from './generic-constraints.js';
import {invokeConstrainedPrimitive} from './constrained-primitive.js';

function closedConstraint(vm, caller, token) {
  if (token >>> 24 === 2) return vm.typeSystem.table(token);
  const name = cachedTypeName(vm, token);
  if (token >>> 24 !== 27 || !/^!!?\d+$/.test(name)) {
    throw new ManagedFault('NotSupportedException', 'A constrained TypeSpec must identify one generic parameter');
  }
  const resolved = resolveCallType(vm, name, caller);
  if (resolved.includes('!')) {
    throw new ManagedFault('InvalidProgramException', 'Constrained generic parameter requires a closed frame context');
  }
  const table = vm.typeSystem.table(resolved);
  if (table.flags.valueType) {
    requireGenericStructArgument(vm, caller.method.token, table);
  }
  return table;
}

/** The verified instruction pair defines the constraint without mutable frame state. */
export function constrainedCallType(vm, caller, instruction, descriptor) {
  if (instruction.name !== 'callvirt') return null;
  const prefix = caller.method.instructions[caller.pc - 2];
  if (prefix?.name !== 'constrained.') return null;
  const primitivePlan = constrainedPrimitivePlan(vm, prefix.operand, descriptor);
  if (primitivePlan) {
    const primitive = vm.typeSystem.table(prefix.operand);
    if (!primitive.flags.primitive || primitive.name !== primitivePlan.name) {
      throw new ManagedFault('NotSupportedException', 'Constrained integer ToString requires its builtin primitive type');
    }
    return primitive;
  }
  const table = closedConstraint(vm, caller, prefix.operand);
  if (prefix.operand >>> 24 === 2 && table.flags.valueType && constrainedObjectPlan(vm, table, descriptor)) return table;
  if (prefix.operand >>> 24 === 2 && constrainedReferenceObjectPlan(vm, table, descriptor)) return table;
  const declaration = vm.typeSystem.table(descriptor.ownerInstance ?? descriptor.ownerToken ?? descriptor.owner);
  if (table.flags.interface || table.genericArity || table.typeArguments.length || table.containsGenericParameters ||
      !vm.typeSystem.types.has(table.definitionToken) || !vm.typeSystem.types.has(declaration.definitionToken) ||
      declaration.genericArity || descriptor.signature.isStatic || descriptor.signature.genericArity ||
      descriptor.methodArguments?.length || (table.flags.valueType ? !declaration.flags.interface : declaration.flags.valueType)) {
    throw new ManagedFault('NotSupportedException', 'Only nongeneric internal constrained class/interface calls are implemented');
  }
  return table;
}

function receiverStorage(vm, receiver, table) {
  if (!receiver?.byref || !Object.isFrozen(receiver)) {
    throw new ManagedFault('InvalidProgramException', 'constrained. requires an owned managed address');
  }
  const current = inspectManagedAddress(vm, receiver);
  if (vm.typeSystem.table(current.type) !== table) {
    throw new ManagedFault('InvalidProgramException', 'constrained. receiver storage has a different declared type');
  }
  return current;
}

/** Read after initialization retries, before pinning call arguments; never overwrite the reference slot. */
export function constrainedReferenceReceiver(vm, table, receiver) {
  const {value} = receiverStorage(vm, receiver, table);
  if (value === undefined) throw new ManagedFault('InvalidProgramException', 'Constrained receiver is uninitialized');
  if (value === null) return null; // Ordinary callvirt owns its managed null fault.
  const actual = vm.heap.get(value).methodTable;
  if (!vm.typeSystem.castCache.isAssignableFrom(table, actual)) {
    throw new ManagedFault('InvalidProgramException', 'Constrained reference is incompatible with its declared storage');
  }
  if (actual.genericArity || actual.typeArguments.length) {
    throw new ManagedFault('NotSupportedException', 'Generic constrained reference receivers are not implemented');
  }
  return value;
}

/** Reference dispatch reuses ordinary slots; admitting DIM bodies is a separate increment. */
export function requireConstrainedReferenceTarget(vm, target) {
  const method = vm.inspector.getMethod(target);
  const owner = vm.typeSystem.table(method.ownerToken);
  if (owner.flags.interface || owner.genericArity || method.signature.genericArity) {
    throw new ManagedFault('NotSupportedException', 'Generic and default-interface constrained calls are not implemented');
  }
}

/** Dispatch an admitted value call after validating its exact owned address. */
export function invokeConstrainedValue(vm, caller, descriptor, table) {
  const count = descriptor.signature.parameters.length + 1;
  const receiver = caller.stack[caller.stack.length - count];
  const current = receiverStorage(vm, receiver, table);
  if (table.flags.primitive) {
    const prefix = caller.method.instructions[caller.pc - 2];
    const primitive = constrainedPrimitivePlan(vm, prefix.operand, descriptor);
    if (primitive) return invokeConstrainedPrimitive(vm, caller, receiver, current, primitive);
  }
  const plan = constrainedObjectPlan(vm, table, descriptor);
  if (plan) return invokeConstrainedObject(vm, caller, descriptor, {table, plan, receiver, current});
  const declaredTarget = descriptor.resolvedToken ?? descriptor.token;
  const target = vm.typeSystem.dispatch.resolve(table.name, declaredTarget, descriptor.ownerInstance);
  requireValueInterfaceTarget(vm, descriptor, target, table);
  if (!verifiedMethod(vm, target)) {
    throw new ManagedFault('NotSupportedException', 'Unverified constrained interface implementation');
  }
  const method = vm.inspector.getMethod(target);
  prepareValueReceiver(vm, method, receiver);
  if (vm.ensureInitialized(table.definitionToken, 'instance-method')) {
    caller.pc--;
    return true;
  }
  const pool = framePool(vm);
  const args = pool.arguments(caller.stack, count);
  try {
    vm.heap.withRoots(args, () => vm.call(target, args));
  } finally {
    pool.releaseArguments(args);
  }
  return true;
}
