import {frameworkAssignable} from '@sharpforge/framework';
import {BinaryName, isNumericMode, decodeNumericMode, numericTypeName} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

/** Types of source constants, including lossless JSON scalar carriers. */
export function constantType(value, flags = 0) {
  if (value?.scalar) return numericTypeName(value.scalar);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'string') return 'string';
  return flags === 1 || !Number.isInteger(value) ? 'double' : 'int';
}

/** The loader leaves extended scalar defaults to the declared-type runtime initializer. */
export function defaultValue(type) {
  return type === 'bool' ? false : type === 'int' || type === 'double' ? 0 : null;
}

export function merge(left, right) {
  if (left === right || frameworkAssignable(left, right)) return left;
  if (frameworkAssignable(right, left)) return right;
  if (left === 'null') return right;
  if (right === 'null') return left;
  if (left === 'int' && right === 'double' || left === 'double' && right === 'int') return 'double';
  if (left === 'object' || right === 'object') return 'object';
  throw new CilError(`Incompatible evaluation-stack types: ${left}, ${right}`);
}

export function binaryType(operator, mode) {
  if (mode === 2) return 'string';
  if (mode === 3 || ['==', '!=', '<', '<=', '>', '>='].includes(BinaryName[operator])) return 'bool';
  return isNumericMode(mode) ? decodeNumericMode(mode).type : mode === 1 || mode === 5 ? 'int' : 'double';
}

export function unaryType(operator, mode, previous) {
  if (isNumericMode(mode)) return decodeNumericMode(mode).type;
  if (operator === 2) return 'bool';
  return operator === 3 || mode === 1 || mode === 5 || previous === 'int' ? 'int' : 'double';
}
