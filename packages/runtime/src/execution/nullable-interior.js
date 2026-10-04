import {ManagedFault} from '../heap.js';
import {nullableTable, nullableValue} from './nullable-value.js';
import {isAggregateType, isValueRecord} from './value-types.js';
import {scalarStorageGuard} from './scalar-storage-plan.js';

export const NullableValueStep = 'nullableValue';
const invalid = () => { throw new ManagedFault('InvalidProgramException', 'Invalid nullable payload address'); };

/** A payload path is legal only through a present nullable of the exact declared, owned type. */
export function requireNullableInterior(vm, value, declaredType) {
  if (!value?.nullableType || value.nullableType.registry !== vm.heap.methodTables) invalid();
  const declared = vm.heap.methodTables.get(declaredType);
  if (!declared.flags.nullable) invalid();
  const table = nullableTable(vm, declared);
  if (!Object.isFrozen(value) || value.nullableType !== table ||
      typeof value.hasValue !== 'boolean' || !value.hasValue && value.value !== null) invalid();
  if (!value.hasValue) throw new ManagedFault('InvalidOperationException', 'Nullable object must have a value');
  const element = table.nullableType;
  if (isAggregateType(element)) {
    if (!isValueRecord(value.value) || value.value.valueType !== element || !Object.isFrozen(value.value) ||
        !Object.isFrozen(value.value.fields) || value.value.fields.length !== element.fields.length) invalid();
  } else {
    const guard = scalarStorageGuard(element.enumUnderlyingType?.name ?? element.name);
    const sourceBoolean = !vm.inspector && element.name === 'System.Boolean' && typeof value.value === 'boolean';
    if (!sourceBoolean && !guard?.(value.value, vm.options)) invalid();
  }
  return element;
}

/** Rebuild the immutable wrapper after updating its addressed payload, retaining normal typed copying. */
export function replaceNullableInterior(vm, value, replacement) {
  requireNullableInterior(vm, value, value.nullableType);
  return nullableValue(vm, value.nullableType, replacement, true);
}
