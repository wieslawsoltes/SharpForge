import {nullableElementType} from '@sharpforge/cil';
import {ManagedFault} from '../heap.js';
import {nullableValue, requireNullable} from './nullable.js';
import {materializeNullableRecord} from './nullable-records.js';

/** ECMA boxing of Nullable<T> is null or a box of T, never a box whose runtime type is Nullable<T>. */
export function boxNullable(vm, value, type) {
  const nullable = requireNullable(vm, value, type);
  if (!nullable.hasValue) return null;
  const stored = materializeNullableRecord(vm, nullable.value);
  return vm.heap.withRoots([stored], () => vm.heap.allocate('box', nullableElementType(type), [stored]));
}

/** unbox.any Nullable<T> accepts only null or an exact T box and copies the underlying immutable data. */
export function unboxNullable(vm, reference, type) {
  if (reference === null) return nullableValue(vm, type, false);
  const element = nullableElementType(type), record = vm.heap.get(reference);
  if (record.kind !== 'box' || record.methodTable !== vm.typeSystem.table(element)) {
    throw new ManagedFault('InvalidCastException', 'Boxed nullable underlying type mismatch');
  }
  return nullableValue(vm, type, true, record.data[0]);
}
