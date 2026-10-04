import { VerificationKind as Kind, verificationType } from './types.js';

const i4 = verificationType(Kind.Int32);
const i8 = verificationType(Kind.Int64);
const native = verificationType(Kind.NativeInt);
const float = verificationType(Kind.Float);
const kinds = [Kind.Int32, Kind.Int64, Kind.NativeInt, Kind.Float];
const indices = Object.freeze(Object.fromEntries(kinds.map((kind, index) => [kind, index])));

// ECMA-335 III.1.5: rows are the earlier (left) operand, columns the top operand.
const arithmetic = Object.freeze([
  Object.freeze([i4, null, native, null]),
  Object.freeze([null, i8, null, null]),
  Object.freeze([native, null, native, null]),
  Object.freeze([null, null, null, float]),
]);
const integer = Object.freeze(arithmetic.map((row, index) =>
  Object.freeze(row.map((value, column) => index === 3 || column === 3 ? null : value))));
const shifts = Object.freeze([
  Object.freeze([i4, null, i4, null]),
  Object.freeze([i8, null, i8, null]),
  Object.freeze([native, null, native, null]),
  Object.freeze([null, null, null, null]),
]);

const definitions = Object.create(null);
function register(names, descriptor) {
  const owned = Object.freeze(descriptor);
  for (const name of names.split(' ')) definitions[name] = owned;
}

register('add sub mul div rem', { operation: 'binary', table: arithmetic, diagnostic: 'ExpectedNumericType' });
register('and or xor div.un rem.un add.ovf add.ovf.un sub.ovf sub.ovf.un mul.ovf mul.ovf.un',
  { operation: 'binary', table: integer, diagnostic: 'ExpectedIntegerType' });
register('shl shr shr.un', { operation: 'shift', table: shifts });
register('neg', { operation: 'unary', floating: true });
register('not', { operation: 'unary', floating: false });
register('ckfinite', { operation: 'finite' });
register('ceq cgt cgt.un clt clt.un', { operation: 'compare', result: i4 });
register('ldc.i4.m1 ldc.i4.0 ldc.i4.1 ldc.i4.2 ldc.i4.3 ldc.i4.4 ldc.i4.5 ldc.i4.6 ldc.i4.7 ldc.i4.8 ldc.i4.s ldc.i4',
  { operation: 'constant', result: i4 });
register('ldc.i8', { operation: 'constant', result: i8 });
register('ldc.r4 ldc.r8', { operation: 'constant', result: float });
register('ldnull', { operation: 'constant', result: verificationType(Kind.Null) });
for (const [suffix, result] of Object.entries({ i1: i4, u1: i4, i2: i4, u2: i4, i4, u4: i4, i8, u8: i8, i: native, u: native })) {
  register(`conv.${suffix} conv.ovf.${suffix} conv.ovf.${suffix}.un`, { operation: 'convert', result });
}
register('conv.r4 conv.r8 conv.r.un', { operation: 'convert', result: float });
for (const [name, operation] of [['ldarg', 'load'], ['starg', 'store'], ['ldarga', 'address'],
  ['ldloc', 'load'], ['stloc', 'store'], ['ldloca', 'address']]) {
  register(`${name} ${name}.s`, { operation, argument: name.includes('arg'), index: null });
  if (name === 'ldarg' || name === 'ldloc' || name === 'stloc') {
    for (let index = 0; index < 4; index++) register(`${name}.${index}`, { operation, argument: name === 'ldarg', index });
  }
}
register('nop break br br.s', { operation: 'none' });
register('dup', { operation: 'duplicate' });
register('pop', { operation: 'discard' });
register('ret', { operation: 'return' });
register('switch', { operation: 'switch' });
register('brtrue brtrue.s brfalse brfalse.s', { operation: 'condition' });
for (const name of ['beq', 'bne.un', 'bge', 'bge.un', 'bgt', 'bgt.un', 'ble', 'ble.un', 'blt', 'blt.un'])
  register(`${name} ${name}.s`, { operation: 'compare', result: null });

export const numericTransfers = Object.freeze(definitions);
export const numericIndex = value => indices[value.kind];
export const integerValue = value => numericIndex(value) !== undefined && value.kind !== Kind.Float;
export const numericResult = (table, left, right) => table[numericIndex(left)]?.[numericIndex(right)] ?? null;

/** ECMA comparability, including reference equality and unsigned object non-equality. */
export function numericComparable(name, left, right) {
  if (numericResult(arithmetic, left, right)) return true;
  const reference = value => value.kind === Kind.Null || value.kind === Kind.Object || value.kind === Kind.Boxed;
  if (reference(left) && reference(right))
    return ['ceq', 'cgt.un', 'beq', 'beq.s', 'bne.un', 'bne.un.s'].includes(name);
  if (left.kind === Kind.ManagedPointer && right.kind === Kind.ManagedPointer)
    return left.type === right.type;
  return false;
}
