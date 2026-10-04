import {isScalarType, unaryScalarType, binaryScalarType} from '../scalar-values.js';
import {n} from './node-factory.js';

/** Lower an increment using promoted arithmetic followed by checked destination narrowing. */
export function scalarStep(node, value, type) {
  if (!isScalarType(type)) return null;
  const promoted = unaryScalarType(type);
  const operation = node.operator === '++' ? '+' : '-';
  const result = n.binary(operation, value, n.literal(1, 'int'), promoted, !!node.isChecked);
  return promoted === type ? result : n.convert(result, type, !!node.isChecked);
}

/** Preserve compound assignment promotion and the conversion back to the location's type. */
export function scalarCompound(node, left, right, type) {
  if (!isScalarType(type) || !isScalarType(right.legacyType)) return null;
  const promoted = binaryScalarType(type, right.legacyType, node.operator);
  const result = n.binary(node.operator, left, right, promoted, !!node.isChecked);
  return promoted === type ? result : n.convert(result, type, !!node.isChecked);
}
