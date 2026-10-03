import {nativeIntegerBits} from './numeric-types.js';
import {nativeInteger} from './native-int.js';
import {float} from './float.js';
import {number, isNumber} from './numeric-values.js';
import {smallIntegerIndirect} from './small-int.js';
import {numericFault} from './checked.js';
import {isDecimal, decimalToInteger, decimalToFloat} from './decimal-ops.js';

const integerTargets = {
  i1: {bits: 8, signed: true}, u1: {bits: 8, signed: false},
  i2: {bits: 16, signed: true}, u2: {bits: 16, signed: false},
  i4: {bits: 32, signed: true}, u4: {bits: 32, signed: false},
  i8: {bits: 64, signed: true}, u8: {bits: 64, signed: false},
  i: {native: true, signed: true}, u: {native: true, signed: false},
};

/** All 13 ECMA conversion target encodings; native targets have two ABI instantiations. */
export const conversionTargets = Object.freeze([
  ...Object.entries(integerTargets).map(([name, layout]) => Object.freeze({name, ...layout})),
  Object.freeze({name: 'r4', floating: true}), Object.freeze({name: 'r8', floating: true}),
  Object.freeze({name: 'r.un', floating: true, unsignedSource: true}),
]);

const targetByName = new Map(conversionTargets.map(target => [target.name, target]));

function invalidConversion(context) {
  if (context.error) throw context.error('Invalid conversion');
  numericFault(context, 'CilError', 'Invalid conversion');
}

function integerBounds(bits, signed) {
  const width = BigInt(bits);
  return {
    minimum: signed ? -(1n << (width - 1n)) : 0n,
    maximum: (1n << (signed ? width - 1n : width)) - 1n,
  };
}

function floatingInteger(value, target, checked, context) {
  if (checked) {
    if (!Number.isFinite(value)) numericFault(context, 'OverflowException', 'Non-finite integer conversion');
    return BigInt(Math.trunc(value));
  }
  // .NET 9/10 saturate i4/u4/i8/u8. Smaller destinations saturate to i4, then narrow.
  const bits = Math.max(target.bits, 32);
  const signed = target.bits < 32 || target.signed;
  const {minimum, maximum} = integerBounds(bits, signed);
  if (Number.isNaN(value)) return 0n;
  if (value <= Number(minimum)) return minimum;
  if (value >= Number(maximum)) return maximum;
  return BigInt(Math.trunc(value));
}

function integerSource(value, raw, target, checked, unsignedSource) {
  if (typeof raw === 'bigint') return unsignedSource ? BigInt.asUintN(64, raw) : raw;
  const zeroExtend = unsignedSource || !checked &&
    (target.name === 'u8' || target.name === 'u' && target.bits === 64);
  return BigInt(zeroExtend ? raw >>> 0 : raw);
}

/** CLI conversions with explicit signed source interpretation and pinned .NET saturation. */
export function convert(name, value, context = {}) {
  if (!isNumber(value) && !isDecimal(value)) {
    numericFault(context, 'InvalidProgramException', 'Numeric conversion required');
  }
  const match = /^conv\.(ovf\.)?(i1|u1|i2|u2|i4|u4|i8|u8|i|u|r4|r8|r)(\.un)?$/.exec(name);
  if (!match) invalidConversion(context);
  const checked = !!match[1];
  const unsignedSource = !!match[3];
  const targetName = match[2] === 'r' && unsignedSource ? 'r.un' : match[2];
  const descriptor = targetByName.get(targetName);
  if (!descriptor || descriptor.floating && checked || unsignedSource && !checked && targetName !== 'r.un') {
    invalidConversion(context);
  }
  const raw = number(value);
  if (descriptor.floating) {
    const kind = targetName === 'r4' ? 'r4' : 'r8';
    if (isDecimal(value)) return float(decimalToFloat(value, kind, context), kind);
    const converted = unsignedSource && !value?.float ?
      (typeof raw === 'bigint' ? BigInt.asUintN(64, raw) : raw >>> 0) : raw;
    return float(Number(converted), kind);
  }
  const target = descriptor.native ? {...descriptor, bits: nativeIntegerBits(context)} : descriptor;
  let integer;
  if (isDecimal(value)) {
    integer = BigInt(decimalToInteger(value, {...context, bits: target.bits, unsigned: !target.signed}));
  } else {
    // Only tagged F values, or out-of-domain direct host inputs, are floating.
    // A valid i4/uint bit pattern such as -1 or 0xffffffff is never reclassified.
    const floating = !!value?.float || typeof raw === 'number' &&
      (!Number.isInteger(raw) || raw < -2147483648 || raw > 4294967295);
    integer = floating ? floatingInteger(raw, target, checked, context) :
      integerSource(value, raw, target, checked, unsignedSource);
  }
  if (checked) {
    const {minimum, maximum} = integerBounds(target.bits, target.signed);
    if (integer < minimum || integer > maximum) {
      numericFault(context, 'OverflowException', 'Checked conversion overflow');
    }
  }
  if (target.bits < 32) return smallIntegerIndirect(integer, target.name, context);
  const narrowed = (target.signed ? BigInt.asIntN : BigInt.asUintN)(target.bits, integer);
  if (target.native) return nativeInteger(narrowed, target.bits);
  return target.bits === 64 ? BigInt.asIntN(64, narrowed) : Number(narrowed) | 0;
}
