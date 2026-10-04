import {
  numericTypeId,
  numericTypeName,
  decodeScalar,
  number
} from '@sharpforge/bytecode';
import {
  ManagedFault,
  isReference
} from '../heap.js';
import {
  isValueRecord,
  createValue
} from './value-types.js';
import {
  boxValue
} from './boxing.js';
import {
  storageValue
} from './storage.js';
import {
  scalarConvert,
  sourceNumericContext
} from './scalar-ops.js';
export {
  sourceInputTypes
}
from './source-input-types.js';

/** Source expression values and storage share value-copy ownership with the CIL runtime. */
export function sourceCopy(vm, value) {
  return isValueRecord(value) ? createValue(vm, value.valueType, value) : value;
}

export function sourceStore(vm, value, target, from = null) {
  const type = typeof target === 'string' ? target : target.name;
  if (value?.scalar) value = decodeScalar(value, sourceNumericContext(vm));
  if (value?.typedReference || value?.runtimeArgumentHandle || value?.argIterator ||
    value?.span || value?.nullableType || value?.memoryPointer || type.endsWith('&')) return storageValue(vm, value, type);
  if (value?.byref) throw new ManagedFault('InvalidProgramException', 'A managed pointer requires byref storage');
  const table = vm.heap.methodTables.get(type);
  if (isValueRecord(value)) return table.flags.valueType ? createValue(vm, table, value) : boxValue(vm, value, value.valueType);
  const scalar = table === vm.heap.methodTables.get('bool') ? 'bool' : numericTypeName(type);
  if (scalar === 'bool') return typeof value === 'boolean' ? value : !!number(value);
  if (numericTypeId(scalar) !== undefined) {
    return scalarConvert(value, numericTypeName(from ?? type), scalar, false, sourceNumericContext(vm));
  }
  if (value !== null && !isReference(value)) {
    const source = value?.enumType ?? from;
    if (source && vm.heap.methodTables.get(source).flags.valueType) return boxValue(vm, value, source);
  }
  return storageValue(vm, value, type);
}
