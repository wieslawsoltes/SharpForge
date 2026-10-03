import {integerArithmetic} from './integer-arithmetic.js';
import {numericFault} from './checked.js';

/** Exact Int64/UInt64 arithmetic; results use the signed CLI Int64 stack pattern. */
export function int64Binary(name, left, right, context) {
  if (typeof left !== 'bigint' || typeof right !== 'bigint' && !name.startsWith('sh')) {
    numericFault(context, 'InvalidProgramException', 'Int64 operands required');
  }
  return integerArithmetic(name, left, right, 64, context);
}

/** Compare signed or unsigned interpretations of two 64-bit stack patterns. */
export function int64Compare(left, right, unsigned = false) {
  const normalize = unsigned ? BigInt.asUintN : BigInt.asIntN;
  const first = normalize(64, left);
  const second = normalize(64, right);
  return first < second ? -1 : first > second ? 1 : 0;
}

/** Unary operations wrap at 64 bits, including negating Int64.MinValue. */
export function int64Unary(name, value, context) {
  if (name !== 'neg' && name !== 'not') {
    numericFault(context, 'InvalidProgramException', 'Invalid Int64 unary operation');
  }
  return BigInt.asIntN(64, name === 'neg' ? -value : ~value);
}
