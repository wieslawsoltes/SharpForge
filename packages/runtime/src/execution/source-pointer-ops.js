import {pointerBinary} from './raw-memory.js';
import {comparePointers} from './pointer-comparison.js';
import {nativePointerConversion} from './native-pointer-conversion.js';
import {isNativeNull} from './native-int.js';

const comparisons = Object.freeze({'==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge'});

/** Pointer arithmetic takes compiler-scaled byte offsets and retains allocation and lifetime checks. */
export function sourcePointerBinary(vm, operation, left, right) {
  if (comparisons[operation]) return comparePointers(vm, left, right, comparisons[operation]);
  return pointerBinary(vm, operation === '+' ? 'add' : operation === '-' ? 'sub' : operation, left, right);
}

export function sourcePointerConvert(vm, value, elementType) {
  if (value === null || value === 0 || value === 0n || isNativeNull(value, vm.options)) return null;
  return nativePointerConversion(vm, value, elementType);
}
