import {ManagedFault, isReference} from '../heap.js';
import {castCacheFor, checkElementStore} from './casting.js';
import {boxValue, unboxValue} from './boxing.js';
import {storageValue} from './storage.js';
import {number} from './numeric-ops.js';
import {widenArrayPrimitive, canWidenArrayPrimitive} from './array-reflection.js';

/** Reject incompatible array categories before any destination element changes. */
export function arrayCopyKind(registry, source, target) {
  if (source === target) return 'same';
  const casts = castCacheFor(registry);
  if (!source.flags.valueType && !target.flags.valueType) {
    if (casts.isAssignableFrom(target, source) || casts.isAssignableFrom(source, target) ||
        source.flags.interface || target.flags.interface) return 'reference';
  } else if (source.flags.valueType && !target.flags.valueType) {
    if (casts.isAssignableFrom(target, source)) return 'box';
  } else if (!source.flags.valueType && target.flags.valueType) {
    if (casts.isAssignableFrom(source, target)) return 'unbox';
  } else if (canWidenArrayPrimitive(source, target)) return 'widen';
  throw new ManagedFault('ArrayTypeMismatchException', 'Array element types cannot be copied');
}

export function copyArrayElement(vm, value, source, target, kind) {
  if (kind === 'box') return boxValue(vm, value, source);
  if (kind === 'unbox') return unboxValue(vm, value, target);
  if (kind === 'widen') return widenArrayPrimitive(vm, value, source, target);
  const result = storageValue(vm, value, target);
  if (kind === 'reference') checkElementStore(vm.heap, target, result);
  return result;
}

/** Array search uses managed Equals semantics for boxed primitives and inline values. */
export function arrayValuesEqual(vm, left, right) {
  if (left === null || right === null) return left === right;
  if (isReference(left) !== isReference(right)) return false;
  if (isReference(left)) {
    const first = vm.heap.get(left);
    const second = vm.heap.get(right);
    if (first.kind === 'string' && second.kind === 'string') return first.data === second.data;
    if (first.kind === 'box' && second.kind === 'box') {
      return first.methodTable === second.methodTable && arrayValuesEqual(vm, first.data[0], second.data[0]);
    }
    return left.h === right.h && left.g === right.g;
  }
  if (left?.valueType || right?.valueType) {
    return left?.valueType === right?.valueType && left.fields.length === right.fields.length &&
      left.fields.every((value, index) => arrayValuesEqual(vm, value, right.fields[index]));
  }
  if (left?.nullableType || right?.nullableType) {
    return left?.nullableType === right?.nullableType && left.hasValue === right.hasValue &&
      (!left.hasValue || arrayValuesEqual(vm, left.value, right.value));
  }
  if (left?.enumType || right?.enumType) return left?.enumType === right?.enumType && left.value === right.value;
  if (left?.decimal || right?.decimal) {
    if (!left?.decimal || !right?.decimal) return false;
    const scale = Math.max(left.scale, right.scale);
    const first = left.coefficient * 10n ** BigInt(scale - left.scale) * (left.negative ? -1n : 1n);
    const second = right.coefficient * 10n ** BigInt(scale - right.scale) * (right.negative ? -1n : 1n);
    return first === second;
  }
  const first = number(left), second = number(right);
  return first === second || typeof first === 'number' && typeof second === 'number' && Number.isNaN(first) && Number.isNaN(second);
}
