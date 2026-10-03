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

const safeMinimum = BigInt(Number.MIN_SAFE_INTEGER);
const safeMaximum = BigInt(Number.MAX_SAFE_INTEGER);
const add = (left, right) => left + right;
const subtract = (left, right) => left - right;
const multiply = (left, right) => left * right;
const divide = (left, right) => Math.trunc(left / right);
const remainder = (left, right) => left % right;
const shiftLeft = (left, right) => left * 2 ** (right & 63);
const shiftRight = (left, right) => Math.floor(left / 2 ** (right & 63));
const smallOperations = Object.freeze({
  add, 'add.ovf': add, 'add.ovf.un': add,
  sub: subtract, 'sub.ovf': subtract, 'sub.ovf.un': subtract,
  mul: multiply, 'mul.ovf': multiply, 'mul.ovf.un': multiply,
  div: divide, 'div.un': divide, rem: remainder, 'rem.un': remainder,
  shl: shiftLeft, shr: shiftRight, 'shr.un': shiftRight,
});
const unsignedOperations = new Set(['add.ovf.un', 'sub.ovf.un', 'mul.ovf.un', 'div.un', 'rem.un', 'shr.un']);

function exactOperand(value, context) {
  if (typeof value !== 'bigint' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    numericFault(context, 'InvalidProgramException', 'Exact Int64 operands required');
  }
}

/**
 * Private Int64 lane representation: exact safe integers use Number, wider bit
 * patterns use BigInt. Callers must retain the Int64 slot tag when using Number.
 */
export function smallInt64(value, context) {
  if (typeof value === 'bigint') {
    return value >= safeMinimum && value <= safeMaximum ? Number(value) : value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value || 0;
  numericFault(context, 'InvalidProgramException', 'Exact Int64 operands required');
}

/**
 * Guarded arithmetic for tagged Int64 lanes. A Number result is accepted only
 * inside the exact integer range; every overflow, unsigned negative operand and
 * unsupported Number operation falls back to the existing full-width helper.
 */
export function smallInt64Binary(name, left, right, context) {
  exactOperand(left, context);
  exactOperand(right, context);
  if (typeof left === 'number' && typeof right === 'number') {
    const unsigned = unsignedOperations.has(name);
    const operation = smallOperations[name];
    if (operation && (!unsigned || left >= 0 && right >= 0)) {
      const result = operation(left, right);
      if (Number.isSafeInteger(result) && (!unsigned || result >= 0)) return result || 0;
    }
  }
  return smallInt64(int64Binary(name, BigInt(left), BigInt(right), context), context);
}

/** Compare small/wide signed CLI bit patterns without changing unsigned ordering. */
export function smallInt64Compare(left, right, unsigned = false) {
  exactOperand(left);
  exactOperand(right);
  if (typeof left === 'number' && typeof right === 'number') {
    if (unsigned && (left < 0) !== (right < 0)) return left < 0 ? 1 : -1;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return int64Compare(BigInt(left), BigInt(right), unsigned);
}

/** Int64 unary operations preserve exact safe values and fall back at boundaries. */
export function smallInt64Unary(name, value, context) {
  exactOperand(value, context);
  if (typeof value === 'number' && Number.isSafeInteger(value) && (name === 'neg' || name === 'not')) {
    const result = name === 'neg' ? -value : -value - 1;
    if (Number.isSafeInteger(result)) return result || 0;
  }
  return smallInt64(int64Unary(name, BigInt(value), context), context);
}
