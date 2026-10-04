import {ManagedFault, isReference} from '../heap.js';
import {executionCodeState} from './code-version.js';
import {createValue, isAggregateType} from './value-types.js';
import {defaults} from './numeric-ops.js';

const admitted = new WeakMap();
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

/** Nullable payloads remain reference-free and use the existing underlying storage admission. */
export function nullableTable(vm, type) {
  const table = vm.typeSystem.table(type), element = table.nullableType;
  if (!element || table.containsGenericParameters || !element.flags.valueType || element.flags.nullable ||
      element.flags.refStruct || element.flags.dynamic || element.name === 'System.Void') {
    throw new ManagedFault('NotSupportedException', 'Nullable requires an admitted non-nullable value type');
  }
  const epoch = executionCodeState(vm);
  let types = admitted.get(epoch);
  if (!types) admitted.set(epoch, types = new WeakSet());
  if (!types.has(table)) {
    if (isAggregateType(element)) createValue(vm, element);
    types.add(table);
  }
  return table;
}

/** No absent payload is retained; present values are normalized/copied before freezing. */
export function nullableValue(vm, type, value = null, hasValue = false) {
  const table = nullableTable(vm, type);
  if (typeof hasValue !== 'boolean') invalid('Nullable HasValue must be Boolean');
  if (hasValue && (value === null || isReference(value) || value?.byref || value?.nullableType || value?.methodPointer)) {
    invalid('Nullable payload must be an admitted value');
  }
  return Object.freeze({nullableType: table, hasValue, value: hasValue ? vm.storage(value, table.nullableType.name) : null});
}

export function copyNullable(vm, value, type) {
  const table = nullableTable(vm, type);
  if (!value || !Object.isFrozen(value) || value.nullableType !== table ||
      typeof value.hasValue !== 'boolean' || !value.hasValue && value.value !== null) {
    throw new ManagedFault('InvalidCastException', 'Nullable value type identity or payload mismatch');
  }
  return nullableValue(vm, table, value.value, value.hasValue);
}

export function nullableDefaultValue(vm, type) {
  const element = nullableTable(vm, type).nullableType;
  return isAggregateType(element) ? createValue(vm, element) : defaults(element.enumUnderlyingType?.name ?? element.name, vm.options);
}
