import {isDecimal, decimal, decimalParse} from './decimal.js';
import {CilError} from '@sharpforge/cil';
import {ManagedFault, isReference} from '../heap.js';
import {float, number} from './numeric-ops.js';
import {isNativeInteger, nativeInteger, nativeIntegerBits} from './native-int.js';

const contexts = new WeakMap();
const maximumIndex = BigInt(Number.MAX_SAFE_INTEGER);
const fault = (name, message) => new ManagedFault(name, message);
const error = message => new CilError(message);
const ranges = {int:[-2147483648,2147483647],uint:[0,4294967295],short:[-32768,32767],ushort:[0,65535],byte:[0,255],sbyte:[-128,127],char:[0,65535]};

/** Bind an explicit ABI once; snapshots retain this host-owned configuration. */
export function bindNativeAbi(options) {
  Object.defineProperty(options, 'nativeIntBits', {
    value: nativeIntegerBits(options), enumerable: true, writable: false, configurable: false
  });
}

export function cilNumericContext(vm) {
  let context = contexts.get(vm);
  if (!context) {
    context = Object.freeze({nativeIntBits: nativeIntegerBits(vm.options), fault, error, isReference});
    contexts.set(vm, context);
  }
  return context;
}

function nativeHostValue(value, type, context) {
  const bits = nativeIntegerBits(context), unsigned = type === 'nuint' || type === 'System.UIntPtr';
  let integer;
  try {
    if (!['number', 'bigint', 'string'].includes(typeof value) ||
        typeof value === 'number' && !Number.isSafeInteger(value) ||
        typeof value === 'string' && !/^[+-]?\d+$/.test(value)) throw new Error();
    integer = BigInt(value);
  } catch { throw new CilError('Native integer arguments require an exact integer or decimal string'); }
  const minimum = unsigned ? 0n : -(1n << BigInt(bits - 1));
  const maximum = (1n << BigInt(unsigned ? bits : bits - 1)) - 1n;
  if (integer < minimum || integer > maximum) throw new CilError('Native integer argument out of range');
  return nativeInteger(integer, bits);
}

/** Marshal host values using the declared CLI storage type, including array elements. */
export function marshalCilValue(vm, value, type) {
  if (type === 'decimal' || type === 'System.Decimal') {
    if (isDecimal(value)) return decimal(value.coefficient, value.scale, value.negative);
    if (typeof value === 'string') return decimalParse(value, cilNumericContext(vm));
    throw new CilError('Decimal arguments require an exact Decimal value or invariant string');
  }
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) throw new CilError(`Expected JSON array for ${type}`);
    const element = type.slice(0, -2), ref = vm.heap.array(element, value.length);
    return vm.heap.withRoots([ref], () => {
      const record = vm.heap.get(ref);
      for (let i = 0; i < value.length; i++) record.data[i] = marshalCilValue(vm, value[i], element);
      return ref;
    });
  }
  if (type === 'nint' || type === 'nuint' || type === 'System.IntPtr' || type === 'System.UIntPtr') {
    return nativeHostValue(value, type, vm.options);
  }
  if (type === 'string') {
    if (value === null) return null;
    if (typeof value !== 'string') throw new CilError('Expected string argument');
    return vm.heap.string(value);
  }
  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new CilError('Expected boolean argument');
    return value ? 1 : 0;
  }
  if (type === 'long' || type === 'ulong') {
    let integer;
    try {
      if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error();
      integer = BigInt(value);
    } catch { throw new CilError('Int64 arguments require an exact integer or decimal string'); }
    if (type === 'long' && (integer < -(1n << 63n) || integer >= (1n << 63n)) ||
        type === 'ulong' && (integer < 0 || integer >= (1n << 64n))) throw new CilError('Int64 argument out of range');
    return BigInt.asIntN(64, integer);
  }
  if (type === 'double' || type === 'float') {
    if (typeof value !== 'number') throw new CilError('Expected numeric argument');
    return float(value, type === 'float' ? 'r4' : 'r8');
  }
  if (Object.hasOwn(ranges, type)) {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new CilError('Expected integer argument');
    if (value < ranges[type][0] || value > ranges[type][1]) throw new CilError(`${type} argument out of range`);
    return value | 0;
  }
  if (type === 'object' && value === null) return null;
  throw new CilError(`Host argument type '${type}' is not supported`);
}

export function cilValue(vm, value) {
  if (value?.float || isNativeInteger(value)) return value.value;
  if (isReference(value)) {
    const record = vm.heap.get(value);
    if (record.kind === 'string') return record.data;
    if (record.kind === 'box') return cilValue(vm, record.data[0]);
  }
  return value;
}

export function cilResultValue(vm) {
  const value = cilValue(vm, vm.returnValue);
  if (vm.returnType === 'uint') return Number(value) >>> 0;
  if (vm.returnType === 'ulong') return BigInt.asUintN(64, value ?? 0n);
  if (vm.returnType === 'nuint' || vm.returnType === 'System.UIntPtr') {
    if (value === null) return null;
    const bits = nativeIntegerBits(vm.options), integer = BigInt.asUintN(bits, BigInt(value));
    return bits === 64 ? integer : Number(integer);
  }
  return vm.returnType === 'bool' ? !!value : value;
}

/** Normalize only exactly representable indexes; bounds checks remain at the array. */
export function cilArrayIndex(value) {
  const raw = number(value);
  return typeof raw === 'bigint' ? raw >= 0n && raw <= maximumIndex ? Number(raw) : NaN : raw;
}
