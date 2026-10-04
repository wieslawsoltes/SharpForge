import {decodeScalar, number} from '@sharpforge/bytecode';
import {bindNativeAbi} from './cil-values.js';
import {defaultValue} from './source-ops.js';
import {sourceNumericContext} from './scalar-ops.js';
import {literalString} from './strings.js';

const hasScalarTag = value => value !== null && typeof value === 'object' && Object.hasOwn(value, 'scalar');

export function initializeSourceNumbers(vm) {
  bindNativeAbi(vm.options);
}

/** Source constant caches are already snapshotted and contain only managed values. */
export function sourceConstant(vm, index) {
  const raw = vm.image.constants[index];
  if (typeof raw === 'string') return literalString(vm, raw);
  if (!hasScalarTag(raw)) return raw;
  if (!vm.constantValues.has(index)) vm.constantValues.set(index, decodeScalar(raw, sourceNumericContext(vm)));
  return vm.constantValues.get(index);
}

export function sourceInitialValue(vm, slot) {
  if (slot.value === null) return defaultValue(slot.type, vm);
  return hasScalarTag(slot.value) ? decodeScalar(slot.value, sourceNumericContext(vm)) : slot.value;
}

export function sourceIndex(value) {
  const raw = number(value);
  return typeof raw === 'bigint' ? raw >= 0n && raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : NaN : raw;
}
