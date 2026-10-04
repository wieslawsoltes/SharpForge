import {ManagedFault} from '../heap.js';
import {nullableValue, copyNullable, nullableDefaultValue} from './nullable-value.js';

/** Execute the same closed contract selected by the CIL verifier, without a fake object receiver. */
export function invokeNullable(vm, definition, args, newObject = false) {
  const self = newObject ? null : args[0];
  const parameters = newObject ? args : args.slice(1);
  if (definition.operation === 'construct') {
    const value = nullableValue(vm, definition.owner, parameters[0], true);
    if (!newObject) vm.dereference(self, true, value);
    return {handled: true, value};
  }
  if (!self?.byref) throw new ManagedFault('InvalidProgramException', 'Nullable instance receiver requires a managed address');
  const value = copyNullable(vm, vm.dereference(self), definition.owner);
  switch (definition.operation) {
    case 'hasValue': return {handled: true, value: value.hasValue ? 1 : 0};
    case 'value':
      if (!value.hasValue) throw new ManagedFault('InvalidOperationException', 'Nullable object must have a value');
      return {handled: true, value: value.value};
    case 'default': return {handled: true, value: value.hasValue ? value.value : parameters.length
      ? vm.storage(parameters[0], value.nullableType.nullableType.name) : nullableDefaultValue(vm, value.nullableType)};
    case 'text': return {handled: true, value: vm.heap.string(value.hasValue ? vm.format(value.value, definition.element) : '')};
    default: throw new ManagedFault('MissingMethodException', 'Unknown Nullable intrinsic');
  }
}
