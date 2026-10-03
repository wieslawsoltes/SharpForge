/** A numeric read-modify-write step used by indexer and tuple lowering. */
import {scalarConvert} from '@sharpforge/bytecode';
import {numeric, unaryPromotion, constantValue} from '../../numeric.js';
import {n} from './node-factory.js';

export function scalarStep(node, value, type) {
  if (!numeric(type)) return null;
  const promoted = unaryPromotion(type);
  const one = n.literal(constantValue(scalarConvert(1, 'int', promoted), promoted), promoted);
  const result = n.binary(node.operator === '++' ? '+' : '-', value, one, promoted, !!node.isChecked);
  return promoted === type ? result : n.convert(result, type, !!node.isChecked);
}
