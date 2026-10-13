import {decodeScalar, number} from '@sharpforge/bytecode';
import {bindNativeAbi} from './cil-values.js';
import {defaultValue} from './source-ops.js';
import {sourceNumericContext} from './scalar-ops.js';
import {literalString} from './strings.js';
import {sourceReadonlyString} from './readonly-string-fields.js';
import {ManagedFault} from '../heap.js';

const hasScalarTag = value => value !== null && typeof value === 'object' && Object.hasOwn(value, 'scalar');

export function initializeSourceNumbers(vm) {
  bindNativeAbi(vm.options);
}

/** Source constant caches are already snapshotted and contain only managed values. */
export function sourceConstant(vm, index) {
  const raw = vm.image.constants[index];
  if (typeof raw === 'string') return literalString(vm, raw);
  if (raw === null || typeof raw !== 'object') return raw;
  const cached = vm.constantValues.get(index);
  if (cached !== undefined) return cached;
  if (Object.hasOwn(raw, 'readonlyField')) {
    return sourceReadonlyString(vm, index, raw.readonlyField);
  }
  if (!Object.hasOwn(raw, 'scalar')) return raw;
  const value = decodeScalar(raw, sourceNumericContext(vm));
  vm.constantValues.set(index, value);
  return value;
}

export function sourceInitialValue(vm, slot) {
  if (slot.value === null) return defaultValue(slot.type, vm);
  if (typeof slot.value === 'object' && Object.hasOwn(slot.value, 'readonlyField')) {
    throw new ManagedFault('InvalidProgramException', 'Readonly field loads cannot be static default values');
  }
  return hasScalarTag(slot.value) ? decodeScalar(slot.value, sourceNumericContext(vm)) : slot.value;
}

export function sourceIndex(value) {
  const raw = number(value);
  return typeof raw === 'bigint' ? raw >= 0n && raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : NaN : raw;
}
