import {ManagedFault} from '../heap.js';
import {unboxValue} from './boxing.js';

/** The selected body must be a concrete nongeneric method owned by this exact value type. */
export function requireValueInterfaceTarget(vm, declaration, target, actual) {
  const declaredType = vm.typeSystem.table(declaration.ownerInstance ?? declaration.ownerToken ?? declaration.owner);
  const method = vm.inspector.getMethod(target), owner = vm.typeSystem.table(method.ownerToken);
  if (declaredType.genericArity || actual.genericArity || method.signature.genericArity || owner.flags.interface) {
    throw new ManagedFault('NotSupportedException', 'Generic and default-interface user-struct calls are not implemented');
  }
  if (owner !== actual) throw new ManagedFault('InvalidProgramException', 'Interface implementation does not belong to the value');
}

/** Adapt only after reference dispatch has selected and verified the concrete implementation. */
export function boxedInterfaceReceiver(vm, declaration, target, receiver) {
  if (declaration.signature.isStatic) return receiver;
  const declaredType = vm.typeSystem.table(declaration.ownerInstance ?? declaration.ownerToken ?? declaration.owner);
  if (!declaredType.flags.interface) return receiver;
  const record = vm.heap.get(receiver), actual = record.methodTable;
  if (record.kind !== 'box' || !actual.flags.valueType || !vm.typeSystem.types.has(actual.definitionToken)) return receiver;
  requireValueInterfaceTarget(vm, declaration, target, actual);
  return unboxValue(vm, receiver, actual, true);
}
