import {ManagedFault, isReference} from '../heap.js';
import {SUSPENDED} from '../platform.js';
import {verifiedMethod} from './token-cache.js';
import {boxedInterfaceReceiver} from './value-dispatch.js';
import {selectedCallOwner} from './generic-calls.js';

/** Finite framework interface slots enter verified managed bodies through ordinary call frames. */
export function invokeFrameworkInterface(vm, descriptor, args, opcode) {
  if (descriptor.resolvedToken || descriptor.signature.isStatic || !['call', 'callvirt'].includes(opcode) || !isReference(args[0]))
    return {handled: false};
  const table = vm.heap.get(args[0]).methodTable;
  if (!vm.typeSystem.types.has(table.definitionToken)) return {handled: false};
  const target = vm.typeSystem.dispatch.externalTarget(table.name, descriptor);
  if (target === null) return {handled: false};
  if (!verifiedMethod(vm, target)) throw new ManagedFault('NotSupportedException', 'Unverified framework interface implementation');
  const owner = selectedCallOwner(vm, target, args[0], table.typeArguments.length ? table.name : null);
  args[0] = boxedInterfaceReceiver(vm, descriptor, target, args[0]);
  vm.call(target, args, {genericIdentity: owner, methodArguments: descriptor.methodArguments});
  return {handled: true, returns: false, value: SUSPENDED};
}
