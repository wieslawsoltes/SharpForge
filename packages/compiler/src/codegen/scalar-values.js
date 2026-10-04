import {numericTypeId, encodeScalar, decimalFromBits} from '@sharpforge/bytecode';

export const isScalarType = type => numericTypeId(type) !== undefined;
export const extendedScalar = type => isScalarType(type) && type !== 'int' && type !== 'double';
export const unaryScalarType = (type, operator) => ['sbyte', 'byte', 'short', 'ushort', 'char'].includes(type)
  ? 'int' : type === 'uint' && operator === '-' ? 'long' : type;

/** Semantic binding has already inserted the implicit numeric operand conversions. */
export function binaryScalarType(left, right, operator) {
  if (['<<', '>>', '>>>'].includes(operator)) return unaryScalarType(left);
  if (left === right) return unaryScalarType(left);
  for (const type of ['decimal', 'double', 'float', 'ulong', 'long', 'nuint', 'nint']) {
    if (left === type || right === type) return type;
  }
  if (left === 'uint' || right === 'uint') {
    return ['sbyte', 'short', 'int'].includes(left === 'uint' ? right : left) ? 'long' : 'uint';
  }
  return 'int';
}

/** Convert binder constants into data-only image constants without narrowing through Number. */
export function scalarImageConstant(value, type) {
  if (value?.scalar) return value;
  let raw = value?.value ?? value;
  if (type === 'decimal' && raw?.toBits) raw = decimalFromBits(raw.toBits());
  if (type === 'int') return Number(raw);
  if (type === 'double' && Number.isFinite(raw) && !Object.is(raw, -0)) return Number(raw);
  return isScalarType(type) ? encodeScalar(raw, type) : raw;
}

export function scalarDefault(type) {
  if (type === 'int' || type === 'double') return 0;
  return {scalar: type, value: type === 'decimal' ? [0, 0, 0, 0] : '0'};
}
