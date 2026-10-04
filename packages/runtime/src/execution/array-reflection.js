import {ManagedFault, isReference} from '../heap.js';
import {storage as numericStorage, number} from './numeric-ops.js';
import {storageDefault} from './storage.js';
import {castCacheFor} from './casting.js';
import {unboxValue} from './boxing.js';
import {enumUnderlying} from './enums.js';

const widening = new Map([
  ['SByte', ['Int16', 'Int32', 'Int64', 'Single', 'Double']],
  ['Byte', ['Char', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64', 'Single', 'Double']],
  ['Int16', ['Int32', 'Int64', 'Single', 'Double']],
  ['UInt16', ['Char', 'Int32', 'UInt32', 'Int64', 'UInt64', 'Single', 'Double']],
  ['Char', ['UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64', 'Single', 'Double']],
  ['Int32', ['Int64', 'Single', 'Double']], ['UInt32', ['Int64', 'UInt64', 'Single', 'Double']],
  ['Int64', ['Single', 'Double']], ['UInt64', ['Single', 'Double']], ['Single', ['Double']]
]);
const fault = (name, message) => new ManagedFault(name, message);

/** Primitive array copies and reflection assignment share one widening matrix. */
export function canWidenArrayPrimitive(sourceType, elementType) {
  const source = sourceType.enumUnderlyingType ?? sourceType;
  const element = elementType.enumUnderlyingType ?? elementType;
  return source.flags.primitive && element.flags.primitive &&
    (source === element || !!widening.get(source.name.slice(7))?.includes(element.name.slice(7)));
}

export function widenArrayPrimitive(vm, value, sourceType, elementType) {
  const source = sourceType.enumUnderlyingType ?? sourceType;
  const element = elementType.enumUnderlyingType ?? elementType;
  let raw = sourceType.flags.enum ? enumUnderlying(value, source.name) : value;
  if (source.name === 'System.UInt64') raw = BigInt.asUintN(64, raw);
  else if (source.name === 'System.UInt32') raw = Number(raw) >>> 0;
  else if (source.name === 'System.Boolean') raw = Number(raw);
  if (element.name === 'System.Single' || element.name === 'System.Double') raw = Number(number(raw));
  return numericStorage(raw, element.name, vm.options);
}

/** Array.SetValue unboxes exact values and performs CLR primitive widening, never narrowing. */
export function reflectedArrayValue(vm, value, element) {
  if (value === null) return storageDefault(vm, element);
  if (!isReference(value)) throw fault('InvalidCastException', 'Array.SetValue requires a boxed value or object reference');
  const record = vm.heap.get(value);
  if (!element.flags.valueType) {
    if (!castCacheFor(vm.heap.methodTables).isAssignableFrom(element, record.methodTable)) {
      throw fault('InvalidCastException', 'Object cannot be stored in this array');
    }
    return value;
  }
  if (record.kind !== 'box') throw fault('InvalidCastException', 'Value cannot be unboxed to this array element');
  if (record.methodTable === element) return unboxValue(vm, value, element);
  const source = record.methodTable.enumUnderlyingType ?? record.methodTable;
  if (!source.flags.primitive || !element.flags.primitive || element.flags.enum ||
      ['System.Decimal', 'System.IntPtr', 'System.UIntPtr'].includes(element.name)) {
    throw fault('InvalidCastException', 'Boxed type is incompatible with this array');
  }
  if (source !== element && !widening.get(source.name.slice(7))?.includes(element.name.slice(7))) {
    throw fault('ArgumentException', 'Array.SetValue does not narrow primitive values');
  }
  return widenArrayPrimitive(vm, record.data[0], record.methodTable, element);
}
