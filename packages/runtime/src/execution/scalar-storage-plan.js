import {isDecimal} from './decimal.js';

const int64Minimum = -(1n << 63n), int64Maximum = (1n << 63n) - 1n;
const int32 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 && !Object.is(value, -0);
const int64 = value => typeof value === 'bigint' && value >= int64Minimum && value <= int64Maximum;
const small = (minimum, maximum) => value => Number.isInteger(value) && value >= minimum && value <= maximum && !Object.is(value, -0);
const single = value => Object.isFrozen(value) && value?.float === 'r4' && typeof value.value === 'number' &&
  Object.is(Math.fround(value.value), value.value);
const double = value => Object.isFrozen(value) && value?.float === 'r8' && typeof value.value === 'number';
const native = (value, options) => Object.isFrozen(value) && value?.nativeInt === (options?.nativeIntBits ?? 32) &&
  (value.nativeInt === 32 ? int32(value.value) : int64(value.value));
const decimal = value => Object.isFrozen(value) && isDecimal(value);

const guards = Object.freeze({
  sbyte: small(-128, 127), byte: small(0, 255), short: small(-32768, 32767),
  ushort: small(0, 65535), char: small(0, 65535), bool: small(0, 255),
  int: int32, uint: int32, long: int64, ulong: int64,
  float: single, double, nint: native, nuint: native, decimal
});
const aliases = Object.freeze({
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Char': 'char', 'System.Boolean': 'bool', 'System.Int32': 'int', 'System.UInt32': 'uint',
  'System.Int64': 'long', 'System.UInt64': 'ulong', 'System.Single': 'float', 'System.Double': 'double',
  'System.IntPtr': 'nint', 'System.UIntPtr': 'nuint', 'System.Decimal': 'decimal'
});

/** Metadata-only classification; enums, modifiers, pointers and unresolved generics have no proof. */
export function scalarStorageGuard(type) {
  if (typeof type !== 'string') return null;
  const name = Object.hasOwn(aliases, type) ? aliases[type] : type;
  return Object.hasOwn(guards, name) ? guards[name] : null;
}
