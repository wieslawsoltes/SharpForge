import {enumTypes} from '@sharpforge/framework';
import {numericTypeNames, isNumericMode, decodeNumericMode, integerType} from './numeric-types.js';
import {decodeScalar} from './scalar-codec.js';
import {verifyReadonlyFieldConstant} from '../readonly-field-constants.js';

/** Reject malformed scalar wire data before executing a source image. ABI-specific limits apply at load. */
export function verifyScalarConstant(value) {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'readonlyField' in value) {
    return verifyReadonlyFieldConstant(value);
  }
  if (value === null || typeof value !== 'object' || !Object.hasOwn(value, 'scalar')) return true;
  try {
    decodeScalar(value, {nativeIntBits: 64});
    return true;
  } catch {
    return false;
  }
}

/** Validate typed operands without executing or allocating guest values. */
export function verifyNumericInstruction(kind, operand, mode) {
  if (!isNumericMode(mode)) {
    if (kind === 'convert') return (operand === 0 || operand === 1 || !!enumTypes[operand - 65536]) &&
      (mode === 0 || mode === 1 && operand !== 1);
    if (kind === 'unary') return ['-', '+', '!', '~'].includes(operand) &&
      ([0, 1].includes(mode) || mode === 5 && operand === '-');
    if (operand === '>>>') return false;
    return [0, 1, 2, 3].includes(mode) || mode === 5 && ['+', '-', '*'].includes(operand);
  }
  const {type} = decodeNumericMode(mode);
  if (kind === 'convert') return Number.isInteger(operand) &&
    (!!numericTypeNames[operand] || !!enumTypes[operand - 65536]);
  if (kind === 'unary') return operand === '+' || operand === '-' || operand === '~' && !!integerType(type);
  if (['&', '|', '^', '<<', '>>', '>>>'].includes(operand)) return !!integerType(type);
  return ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>='].includes(operand);
}
