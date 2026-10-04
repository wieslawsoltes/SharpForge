import {decodeScalar} from '@sharpforge/bytecode';
import {decimalConstants} from './decimal-intrinsics.js';
import {storageDefault} from './storage.js';
import {initializeReadonlyString} from './readonly-string-fields.js';

/** Allocating readonly values publish themselves only after reentry and cancellation checks succeed. */
export function initializeStaticFieldSlot(vm, key, field) {
  if (field.externalField?.type === 'string') {
    return initializeReadonlyString(vm, {owner: field.owner, name: field.name, value: field.externalField.value}, vm.statics, key) !== null;
  }
  vm.statics.set(key, initialStaticFieldValue(vm, field));
  return true;
}

/** Decode immutable profile values once per physical static slot; Decimal retains its existing value provider. */
export function initialStaticFieldValue(vm, field) {
  if (field.externalField) {
    const value = field.externalField.value;
    return typeof value === 'boolean' ? Number(value) : decodeScalar(value, vm.options);
  }
  if (field.decimalConstant) return decimalConstants[field.decimalConstant];
  return storageDefault(vm, field.signature.type);
}
