/**
 * Implicit constant expression conversions (SF-A02-T01.3, C# spec 10.2.11):
 *   - a constant of type int converts to sbyte, byte, short, ushort, uint, ulong (and nint is implicit anyway; nuint
 *     when non-negative) when its value is in the range of the destination;
 *   - a constant of type long converts to ulong when it is not negative.
 * A numeric constant that has only an explicit conversion to the destination and does not fit reports CS0031
 * ("Constant value '300' cannot be converted to a 'byte'") instead of CS0266.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { integralRange, isIntegralKind, isNumericKind, implicitNumericConversion } from './numeric.js';

const fromInt = new Set(['sbyte', 'byte', 'short', 'ushort', 'uint', 'ulong', 'nuint']);
const big = value => (typeof value === 'bigint' ? value : BigInt(value));
/** True when a constant of numeric kind `from` with integral `value` converts implicitly to `to` by the constant rule. */
export function implicitConstantConversion(from, value, to) {
  if (value === null || value === undefined) return false;
  if (from === 'int' && fromInt.has(to)) {
    const v = big(value),
      [lo, hi] = integralRange(to === 'nuint' ? 'uint' : to);
    return v >= lo && v <= hi;
  }
  return from === 'long' && to === 'ulong' && big(value) >= 0n;
}
/**
 * Classifies assigning a numeric constant to a numeric destination.
 * @param {string} from numeric kind of the constant @param value its value (number, BigInt, Decimal) @param {string} to destination kind
 * @param {{isLiteralOrConstant?:boolean}} [options]
 * @returns {'identity'|'implicitNumeric'|'implicitConstant'|{code:'CS0031',args:[string,string]}|{code:'CS0266'}|{code:'CS0664'}|null}
 *   null when either side is not numeric. CS0664 is the "literal of type double cannot be implicitly converted to
 *   float/decimal; use an F/M suffix" error Roslyn prefers over CS0266 for real literals.
 */
export function classifyConstantNarrowing(from, value, to, { isRealLiteral = false, display = null } = {}) {
  if (!isNumericKind(from) || !isNumericKind(to)) return null;
  if (from === to) return 'identity';
  if (implicitNumericConversion(from, to)) return 'implicitNumeric';
  if (isIntegralKind(from) && from !== 'char' && implicitConstantConversion(from, value, to)) return 'implicitConstant';
  if (from === 'double' && isRealLiteral && (to === 'float' || to === 'decimal'))
    return { code: DiagnosticId.CS0664, args: [to === 'float' ? 'F' : 'M', to] };
  // Roslyn reports CS0031 for a constant that would convert by the constant rule if only its value fitted (an int constant
  // to a smaller or unsigned type, a long constant to ulong); other narrowing constants are ordinary CS0266.
  if (((from === 'int' && fromInt.has(to)) || (from === 'long' && to === 'ulong')) && value !== null && value !== undefined) {
    const v = big(value),
      [lo, hi] = integralRange(to);
    if (v < lo || v > hi) return { code: DiagnosticId.CS0031, args: [display ?? String(v), to] };
  }
  return { code: DiagnosticId.CS0266 };
}
