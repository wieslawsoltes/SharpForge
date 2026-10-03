/**
 * Checked and unchecked arithmetic and conversions for every numeric width (SF-A02-T01.4).
 *
 * `arithmeticInstruction` and `conversionInstructions` select the ECMA-335 instruction a back end needs for an operator
 * or numeric conversion in a checked or unchecked context: `add` / `add.ovf` / `add.ovf.un`, `conv.i1` /
 * `conv.ovf.i1` / `conv.ovf.i1.un`, `conv.r.un` before unsigned-to-real, and so on. `evaluateArithmetic` and
 * `evaluateConversion` are the reference semantics of those instructions - wrap in an unchecked context,
 * `{exception:'System.OverflowException'}` in a checked one - used to fold lowered constants and to test back ends.
 *
 * The 30-opcode bytecode IR only has Int32 `BINARY` and a single `CONVERT`; `irSupport` says which selections it can
 * express, so the emitter can refuse the others instead of miscompiling them.
 */
import {
  integralBits,
  integralRange,
  isIntegralKind,
  isSignedKind,
  isNumericKind,
  wrapIntegral,
  isFloatingKind,
} from '../conversions/numeric.js';
import { evaluateReal, convertReal } from '../conversions/reals.js';

const overflowing = Object.freeze({ '+': 'add', '-': 'sub', '*': 'mul' });
const plain = Object.freeze({
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '%': 'rem',
  '&': 'and',
  '|': 'or',
  '^': 'xor',
  '<<': 'shl',
  '>>': 'shr',
  '>>>': 'shr.un',
});
/** Stack type an operand kind is computed in: small types are widened to int32 first. */
export const stackKind = kind => (['sbyte', 'byte', 'short', 'ushort', 'char', 'int'].includes(kind) ? 'int' : kind);
/**
 * The instruction for `left op right` computed in numeric kind `kind` (after binary numeric promotion).
 * decimal has no instruction: it calls System.Decimal operators (`{call:'System.Decimal::op_Addition'}`).
 * @returns {{opcode:string}|{call:string}}
 */
export function arithmeticInstruction(operator, kind, { checked = false } = {}) {
  if (kind === 'decimal') {
    const names = { '+': 'op_Addition', '-': 'op_Subtraction', '*': 'op_Multiply', '/': 'op_Division', '%': 'op_Modulus' };
    if (!names[operator]) throw new RangeError(`decimal has no operator '${operator}'`);
    return { call: 'System.Decimal::' + names[operator] };
  }
  if (!plain[operator]) throw new RangeError(`'${operator}' is not an arithmetic operator`);
  const unsigned = isIntegralKind(kind) && !isSignedKind(kind);
  if (checked && overflowing[operator] && isIntegralKind(kind)) return { opcode: overflowing[operator] + '.ovf' + (unsigned ? '.un' : '') };
  if (operator === '/' || operator === '%') return { opcode: plain[operator] + (unsigned ? '.un' : '') };
  if (operator === '>>') return { opcode: unsigned ? 'shr.un' : 'shr' };
  return { opcode: plain[operator] };
}
/** Unary minus: `neg`, or `ldc.i4.0; sub.ovf` in a checked integral context (neg never traps). */
export function negateInstructions(kind, { checked = false } = {}) {
  if (kind === 'decimal') return [{ call: 'System.Decimal::op_UnaryNegation' }];
  return checked && isIntegralKind(kind) ? [{ opcode: 'ldc.0', operandFirst: true }, { opcode: 'sub.ovf' }] : [{ opcode: 'neg' }];
}
const convSuffix = Object.freeze({
  sbyte: 'i1',
  byte: 'u1',
  short: 'i2',
  ushort: 'u2',
  char: 'u2',
  int: 'i4',
  uint: 'u4',
  long: 'i8',
  ulong: 'u8',
  nint: 'i',
  nuint: 'u',
  float: 'r4',
  double: 'r8',
});
/**
 * The instruction sequence converting a value of numeric kind `from` to `to`.
 * Empty when the stack representation already is the target (int to int, byte to int, ...).
 */
export function conversionInstructions(from, to, { checked = false } = {}) {
  if (!isNumericKind(from) || !isNumericKind(to)) throw new RangeError(`No numeric conversion from '${from}' to '${to}'`);
  if (from === to) return [];
  if (from === 'decimal' || to === 'decimal')
    return [{ call: `System.Decimal::${to === 'decimal' && isIntegralKind(from) ? 'op_Implicit' : 'op_Explicit'}(${from})->${to}` }];
  const sourceUnsigned = isIntegralKind(from) && !isSignedKind(from);
  if (isFloatingKind(to)) {
    // Unsigned 32/64-bit sources need conv.r.un so the value is not read as negative.
    if (sourceUnsigned && integralBits[from] >= 32) return [{ opcode: 'conv.r.un' }, { opcode: 'conv.' + convSuffix[to] }];
    return [{ opcode: 'conv.' + convSuffix[to] }];
  }
  const widening =
    isIntegralKind(from) &&
    (() => {
      const [flo, fhi] = integralRange(from),
        [tlo, thi] = integralRange(to);
      return flo >= tlo && fhi <= thi;
    })();
  if (widening) {
    // A value that already fits needs only sign- or zero-extension to the target stack width.
    if (stackKind(from) === stackKind(to)) return [];
    return [{ opcode: 'conv.' + (sourceUnsigned ? convSuffix[to].replace('i', 'u') : convSuffix[to]) }];
  }
  if (checked) return [{ opcode: 'conv.ovf.' + convSuffix[to] + (sourceUnsigned ? '.un' : '') }];
  return [{ opcode: 'conv.' + convSuffix[to] }];
}
/** What the 30-opcode IR can express: Int32 arithmetic (wrapping, or checked through its overflow flag) and int/double conversion. */
export function irSupport(kind) {
  return kind === 'int' || kind === 'double' || kind === 'bool';
}

const overflow = Object.freeze({ exception: 'System.OverflowException' }),
  divideByZero = Object.freeze({ exception: 'System.DivideByZeroException' });
/**
 * Reference evaluation of `a op b` in numeric kind `kind`. Integral operands and results are BigInt.
 * @returns {{value:any}|{exception:string}}
 */
export function evaluateArithmetic(operator, kind, a, b, { checked = false } = {}) {
  if (!isIntegralKind(kind)) return evaluateReal(operator, kind, a, b);
  const x = BigInt(a),
    y = BigInt(b),
    [lo, hi] = integralRange(kind),
    bits = integralBits[kind] < 32 ? 32 : integralBits[kind];
  let r;
  switch (operator) {
    case '+':
      r = x + y;
      break;
    case '-':
      r = x - y;
      break;
    case '*':
      r = x * y;
      break;
    case '/':
      if (y === 0n) return divideByZero;
      if (isSignedKind(kind) && x === lo && y === -1n) return overflow;
      r = x / y;
      break;
    case '%':
      if (y === 0n) return divideByZero;
      if (isSignedKind(kind) && x === lo && y === -1n) return checked ? overflow : { value: 0n };
      r = x % y;
      break;
    case '&':
      r = x & y;
      break;
    case '|':
      r = x | y;
      break;
    case '^':
      r = x ^ y;
      break;
    case '<<':
      r = x << (y & BigInt(bits - 1));
      return { value: wrapIntegral(r, kind) };
    case '>>':
      return { value: x >> (y & BigInt(bits - 1)) };
    case '>>>':
      return { value: wrapIntegral(BigInt.asUintN(bits, x) >> (y & BigInt(bits - 1)), kind) };
    case '==':
      return { value: x === y };
    case '!=':
      return { value: x !== y };
    case '<':
      return { value: x < y };
    case '>':
      return { value: x > y };
    case '<=':
      return { value: x <= y };
    case '>=':
      return { value: x >= y };
    default:
      throw new RangeError(`No integral operator '${operator}'`);
  }
  if (r < lo || r > hi) return checked ? overflow : { value: wrapIntegral(r, kind) };
  return { value: r };
}
/** Reference evaluation of unary minus: `-int.MinValue` overflows in a checked context and wraps otherwise. */
export function evaluateNegate(kind, value, { checked = false } = {}) {
  if (!isIntegralKind(kind)) return { value: kind === 'float' ? Math.fround(-value) : -value };
  return evaluateArithmetic('-', kind, 0n, value, { checked });
}
/** Reference evaluation of a numeric conversion. Integral values are BigInt, float/double are numbers. */
export function evaluateConversion(value, from, to, { checked = false } = {}) {
  if (from === to) return { value };
  if (!isIntegralKind(from)) return convertReal(value, from, to, { checked });
  const v = BigInt(value);
  if (to === 'float') return { value: Math.fround(Number(v)) };
  if (to === 'double') return { value: Number(v) };
  if (to === 'decimal') return { value: v };
  const [lo, hi] = integralRange(to);
  if (v < lo || v > hi) return checked ? overflow : { value: wrapIntegral(v, to) };
  return { value: v };
}
