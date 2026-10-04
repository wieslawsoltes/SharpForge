import {ManagedFault} from '../heap.js';
import {framePool} from './frame-pool.js';
import {inspectManagedAddress} from './managed-address.js';
import {prepareValueReceiver} from './value-calls.js';
import {requireValueInterfaceTarget} from './value-dispatch.js';
import {verifiedMethod} from './token-cache.js';

/** Dispatch an admitted interface call on its original owned value address without allocating a box. */
export function invokeConstrainedInterface(vm, caller, instruction, descriptor) {
  if (instruction.name !== 'callvirt') return false;
  const prefix = caller.method.instructions[caller.pc - 2];
  if (prefix?.name !== 'constrained.') return false;
  const table = vm.typeSystem.table(prefix.operand);
  const declaration = vm.typeSystem.table(descriptor.ownerInstance ?? descriptor.ownerToken ?? descriptor.owner);
  if (prefix.operand >>> 24 !== 2 || !table.flags.valueType || table.genericArity || table.typeArguments.length ||
      !vm.typeSystem.types.has(table.definitionToken) || !declaration.flags.interface || descriptor.signature.isStatic) {
    throw new ManagedFault('NotSupportedException', 'Only nongeneric user-struct constrained interface calls are implemented');
  }
  const count = descriptor.signature.parameters.length + 1;
  const receiver = caller.stack[caller.stack.length - count];
  if (!receiver?.byref || !Object.isFrozen(receiver)) {
    throw new ManagedFault('InvalidProgramException', 'constrained. requires an owned managed address');
  }
  const current = inspectManagedAddress(vm, receiver);
  if (vm.typeSystem.table(current.type) !== table) {
    throw new ManagedFault('InvalidProgramException', 'constrained. receiver storage has a different declared type');
  }
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
