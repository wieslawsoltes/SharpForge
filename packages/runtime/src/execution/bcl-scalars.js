import {numericFormat, numericTypeName, numericTypeNames, isDecimal, isNativeInteger} from '@sharpforge/bytecode';
import {ManagedFault, isReference} from '../heap.js';
import {boxValue} from './value-types.js';

function scalar(platform, value, type) {
  if (value?.byref) return scalar(platform, platform.vm.dereference(value), type);
  if (isReference(value)) {
    const record = platform.heap.get(value);
    if (record.kind === 'box') return scalar(platform, record.data[0], record.methodTable.name);
    return {value, type: null};
  }
  type ??= isDecimal(value) ? 'decimal' : value?.float === 'r4' ? 'float' : value?.float ? 'double' :
    isNativeInteger(value) ? 'nint' : typeof value === 'bigint' ? 'long' :
    typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'double' : null;
  return {value, type: type === null ? null : numericTypeName(type)};
}

/** BCL formatting hook: undefined delegates non-scalars to the package's ordinary text handling. */
export function formatBclScalar(platform, value, format, type) {
  const current = scalar(platform, value, type);
  if (current.value == null || !numericTypeNames.includes(current.type) && current.type !== 'bool') return undefined;
  return numericFormat(current.value, current.type, format, {
    ...platform.vm.options, fault: (name, message) => new ManagedFault(name, message)
  });
}

/** Preserve the exact scalar payload and declared MethodTable across compiler formatting boxes. */
export function boxBclScalar(platform, value, type) {
  type = numericTypeName(type);
  if (!numericTypeNames.includes(type) && type !== 'bool') {
    throw new ManagedFault('InvalidOperationException', 'Unknown primitive box');
  }
  const current = scalar(platform, value, type);
  if (current.type !== type) throw new ManagedFault('InvalidCastException', 'Boxed scalar type does not match its declared type');
  return boxValue(platform.vm, current.value, type);
}
