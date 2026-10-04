import {nativeIntegerBits} from './native-int.js';

/** Append-only source scalar IDs. The original Int32/Double conversions stay 0/1. */
export const numericTypeNames = Object.freeze([
  'int', 'double', 'sbyte', 'byte', 'short', 'ushort', 'uint', 'long',
  'ulong', 'nint', 'nuint', 'float', 'decimal', 'char'
]);
export const NumericType = Object.freeze(Object.fromEntries(numericTypeNames.map((name, id) => [name, id])));
export const numericAliases = Object.freeze({
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong',
  'System.IntPtr': 'nint', 'System.UIntPtr': 'nuint', 'System.Char': 'char',
  'System.Single': 'float', 'System.Double': 'double', 'System.Decimal': 'decimal'
});
export const numericTypeName = type => typeof type === 'number' ? numericTypeNames[type]
  : Object.hasOwn(numericAliases, type) ? numericAliases[type] : type;
export const numericTypeId = type => {
  const name = numericTypeName(type);
  return Object.hasOwn(NumericType, name) ? NumericType[name] : undefined;
};
const modes = Object.freeze(numericTypeNames.flatMap(type => [
  Object.freeze({type, checked: false}), Object.freeze({type, checked: true})
]));

/** Typed modes start at 16; legacy modes 0,1,2,3,5 retain their original meaning. */
export function numericMode(type, checked = false) {
  const id = numericTypeId(type);
  if (id === undefined || typeof checked !== 'boolean') throw new TypeError('Invalid scalar mode');
  return 16 + id * 2 + Number(checked);
}
export function decodeNumericMode(mode) {
  if (!Number.isInteger(mode) || !modes[mode - 16]) throw new TypeError('Invalid scalar mode');
  return modes[mode - 16];
}
export const isNumericMode = mode => Number.isInteger(mode) && mode >= 16 && mode < 16 + modes.length;

const widths = {sbyte: 8, byte: 8, short: 16, ushort: 16, char: 16, int: 32, uint: 32, long: 64, ulong: 64};
const unsigned = new Set(['byte', 'ushort', 'char', 'uint', 'ulong', 'nuint']);
const layouts = bits => Object.freeze(Object.fromEntries(Object.entries({...widths, nint: bits, nuint: bits})
  .map(([type, width]) => [type, Object.freeze({type, bits: width, unsigned: unsigned.has(type), native: type === 'nint' || type === 'nuint'})])));
const layouts32 = layouts(32), layouts64 = layouts(64);

/** Immutable declared-width metadata, shared by source lowering and execution. */
export function integerType(type, context) {
  const table = nativeIntegerBits(context) === 64 ? layouts64 : layouts32, name = numericTypeName(type);
  return Object.hasOwn(table, name) ? table[name] : null;
}
