import {pushNullableText} from '../nullable-methods.js';
import {Op} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {nullableValue, copyNullable, nullableDefaultValue} from '../nullable-value.js';

export const sourceNullableHandlers = Object.freeze({
  [Op.NULLABLE](vm, frame, typeIndex, operation) {
    const type = vm.image.constants[typeIndex];
    if (operation === 0) { vm.stack.push(nullableValue(vm, type)); return; }
    if (operation === 1) { vm.stack.push(nullableValue(vm, type, vm.stack.pop(), true)); return; }
    if (operation === 6) { pushNullableText(vm, vm.stack.pop(), type); return; }
    const fallback = operation === 5 ? vm.stack.pop() : null;
    const value = copyNullable(vm, vm.stack.pop(), type);
    if (operation === 2) { vm.stack.push(value.hasValue); return; }
    if (operation === 3 && !value.hasValue) throw new ManagedFault('InvalidOperationException', 'Nullable object must have a value');
    vm.stack.push(value.hasValue ? value.value : operation === 5 ? vm.storage(fallback, value.nullableType.nullableType.name)
      : nullableDefaultValue(vm, value.nullableType));
  }
});
