import {float} from './float.js';
import {number, isNumber} from './numeric-values.js';
import {smallIntegerIndirect} from './small-int.js';
import {nativeInteger, nativeIntegerBits} from './native-int.js';
import {numericFault} from './checked.js';

const integerTargets = {
  i1: {bits: 8, signed: true}, u1: {bits: 8, signed: false},
  i2: {bits: 16, signed: true}, u2: {bits: 16, signed: false},
  i4: {bits: 32, signed: true}, u4: {bits: 32, signed: false},
  i8: {bits: 64, signed: true}, u8: {bits: 64, signed: false},
  i: {bits: 32, native: true, signed: true}, u: {bits: 32, native: true, signed: false},
};

/** All 13 ECMA conversion targets; native metadata describes the default 32-bit ABI. */
export const conversionTargets = Object.freeze([
  ...Object.entries(integerTargets).map(([name, layout]) => Object.freeze({name, ...layout})),
  Object.freeze({name: 'r4', floating: true}), Object.freeze({name: 'r8', floating: true}),
  Object.freeze({name: 'r.un', floating: true, unsignedSource: true}),
]);

function invalidConversion(context) {
  if (context.error) throw context.error('Invalid conversion');
  numericFault(context, 'CilError', 'Invalid conversion');
}

function integerBounds(bits, signed) {
  const width = BigInt(bits);
  const minimum = signed ? -(1n << (width - 1n)) : 0n;
  const maximum = (1n << (signed ? width - 1n : width)) - 1n;
  return Object.freeze({minimum, maximum, numericMinimum: Number(minimum), numericMaximum: Number(maximum)});
}

function compilePolicies(nativeIntBits) {
  const targets = conversionTargets.map(target => target.native && nativeIntBits === 64 ?
    Object.freeze({...target, bits: 64}) : target);
  const policies = new Map();
  const boundsByLayout = new Map();
  for (const target of targets) {
    if (!target.floating) {
      const key = target.bits * 2 + Number(target.signed);
      if (!boundsByLayout.has(key)) boundsByLayout.set(key, integerBounds(target.bits, target.signed));
    }
  }
  for (const target of targets) {
    if (target.floating) {
      policies.set('conv.' + target.name, Object.freeze({
        target, unsignedSource: !!target.unsignedSource, kind: target.name === 'r4' ? 'r4' : 'r8'
      }));
      continue;
    }
    const bounds = boundsByLayout.get(target.bits * 2 + Number(target.signed));
    const saturationBounds = target.bits < 32 ? boundsByLayout.get(32 * 2 + 1) : bounds;
    const layout = {target, bounds, saturationBounds};
    policies.set('conv.' + target.name, Object.freeze({...layout, checked: false, unsignedSource: false}));
    policies.set('conv.ovf.' + target.name, Object.freeze({...layout, checked: true, unsignedSource: false}));
    policies.set('conv.ovf.' + target.name + '.un', Object.freeze({...layout, checked: true, unsignedSource: true}));
  }
  return policies;
}

// Opcode parsing and bounds construction belong to policy initialization, not guest execution.
const conversionPolicies32 = compilePolicies(32);
const conversionPolicies64 = compilePolicies(64);
const emptyContext = Object.freeze({});

function floatingInteger(value, policy, context) {
  if (policy.checked) {
    if (!Number.isFinite(value)) numericFault(context, 'OverflowException', 'Non-finite integer conversion');
    return BigInt(Math.trunc(value));
  }
  // .NET 9/10 saturate i4/u4/i8/u8. Smaller destinations saturate to i4, then narrow.
  const {minimum, maximum, numericMinimum, numericMaximum} = policy.saturationBounds;
  if (Number.isNaN(value)) return 0n;
  if (value <= numericMinimum) return minimum;
  if (value >= numericMaximum) return maximum;
  return BigInt(Math.trunc(value));
}

function integerSource(raw, target, checked, unsignedSource) {
  if (typeof raw === 'bigint') return unsignedSource ? BigInt.asUintN(64, raw) : raw;
  const zeroExtend = unsignedSource || !checked && (target.name === 'u8' || target.name === 'u' && target.bits === 64);
  return BigInt(zeroExtend ? raw >>> 0 : raw);
}

/** CLI conversions with explicit signed source interpretation and pinned .NET saturation. */
export function convert(name, value, context = emptyContext) {
  if (!isNumber(value)) {
    numericFault(context, 'InvalidProgramException', 'Numeric conversion required');
  }
  const policies = nativeIntegerBits(context) === 64 ? conversionPolicies64 : conversionPolicies32;
  const policy = policies.get(name);
  if (!policy) invalidConversion(context);
  const {target, checked, unsignedSource} = policy;
  const raw = number(value);
  if (target.floating) {
    const converted = unsignedSource && !value?.float ?
      (typeof raw === 'bigint' ? BigInt.asUintN(64, raw) : raw >>> 0) : raw;
    return float(Number(converted), policy.kind);
  }
  // Tagged F values retain their source kind even inside the Int32 domain.
  // Direct host inputs outside that domain also take the floating path.
  const floating = !!value?.float || typeof raw === 'number' &&
    (!Number.isInteger(raw) || raw < -2147483648 || raw > 4294967295);
  const integer = floating ? floatingInteger(raw, policy, context) :
    integerSource(raw, target, checked, unsignedSource);
  if (checked) {
    const {minimum, maximum} = policy.bounds;
    if (integer < minimum || integer > maximum) {
      numericFault(context, 'OverflowException', 'Checked conversion overflow');
    }
  }
  if (target.native) return nativeInteger(integer, target.bits);
  if (target.bits < 32) return smallIntegerIndirect(integer, target.name, context);
  const narrowed = (target.signed ? BigInt.asIntN : BigInt.asUintN)(target.bits, integer);
  return target.bits === 64 ? BigInt.asIntN(64, narrowed) : Number(narrowed) | 0;
}
