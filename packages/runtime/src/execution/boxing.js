import {frameworkType} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {castReference} from './casting.js';
import {isDecimal} from './decimal.js';
import {isNumber} from './numeric-ops.js';
import {isAggregateType} from './value-types.js';
import {nullableValue, copyNullable} from './nullable-value.js';

/** Copy an admitted value into a box whose canonical MethodTable retains its exact type. */
export function boxValue(vm, value, type) {
  const table = vm.typeSystem.table(type);
  if (table.flags.nullable) {
    const nullable = copyNullable(vm, value, table);
    return nullable.hasValue ? boxValue(vm, nullable.value, table.nullableType) : null;
  }
  if (!table.flags.valueType) return castReference(vm.heap, value, table);
  // Registered framework values retain their existing immutable heap-backed representation.
  if (isReference(value) && frameworkType(table.name)?.kind === 'value' && vm.heap.get(value).type === table.name) {
    return vm.heap.withRoots([value], () => {
      const record = vm.heap.get(value);
      const copy = vm.heap.allocate(record.kind, record.type, [...record.data]);
      return vm.heap.allocate('box', table, [copy], [copy]);
    });
  }
  if (isAggregateType(table)) {
    // Storage owns layout admission, recursive copies, VM identity and reference rejection.
    return vm.heap.allocate('box', table, [vm.storage(value, table.name)]);
  }
  if (isDecimal(value) && table.name !== 'System.Decimal') {
    throw new ManagedFault('InvalidProgramException', 'Decimal boxing requires its declared type');
  }
  if (!isNumber(value) && !isDecimal(value)) {
    throw new ManagedFault('NotSupportedException', 'Only admitted scalar, sequential struct and registered WinUI value boxing is implemented');
  }
  return vm.heap.allocate('box', table, [vm.storage(value, table.name)]);
}

function unboxCompatible(boxed, requested) {
  if (boxed === requested) return true;
  if (!boxed.flags.enum && !requested.flags.enum) return false;
  // CLR unboxing compares exact underlying primitive types, not reduced array element types.
  // Distinct enums with the same underlying type are compatible; signed/unsigned pairs are not.
  const actual = boxed.flags.enum ? boxed.enumUnderlyingType : boxed;
  const expected = requested.flags.enum ? requested.enumUnderlyingType : requested;
  return !!actual?.flags.primitive && actual === expected;
}

/** unbox retains a live owned location; unbox.any copies through the declared storage adapter. */
export function unboxValue(vm, reference, type, byReference = false) {
  const table = vm.typeSystem.table(type);
  if (table.flags.nullable) {
    if (byReference) throw new ManagedFault('NotSupportedException', 'A Nullable box interior is not supported');
    if (reference === null) return nullableValue(vm, table);
    const record = vm.heap.get(reference);
    // Nullable<T> requires exact T; ordinary enum unboxing compatibility does not apply.
    if (record.kind !== 'box' || record.methodTable !== table.nullableType) {
      throw new ManagedFault('InvalidCastException', 'Nullable boxed type mismatch');
    }
    return nullableValue(vm, table, record.data[0], true);
  }
  if (!byReference && !table.flags.valueType) return castReference(vm.heap, reference, table);
  const record = vm.heap.get(reference);
  if (record.kind !== 'box' || !unboxCompatible(record.methodTable, table)) {
    throw new ManagedFault('InvalidCastException', 'Boxed type mismatch');
  }
  return byReference ? vm.address('box', 0, reference) : vm.storage(record.data[0], table.name);
}
