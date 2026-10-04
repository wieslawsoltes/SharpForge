import {decodeScalar} from '@sharpforge/bytecode';
import {decimalConstants} from './decimal-intrinsics.js';
import {storageDefault} from './storage.js';

/** Decode immutable profile values once per physical static slot; Decimal retains its existing value provider. */
export function initialStaticFieldValue(vm, field) {
  if (field.externalField) {
    const value = field.externalField.value;
    return typeof value === 'boolean' ? Number(value) : decodeScalar(value, vm.options);
  }
  if (field.decimalConstant) return decimalConstants[field.decimalConstant];
  return storageDefault(vm, field.signature.type);
}
