import {n} from './node-factory.js';
import {scalarImageConstant} from '../scalar-values.js';

const numericNames = new Set(['int', 'uint', 'float', 'double']);

/** No new source opcode is needed: a precise box and checked unbox preserve the target's storage identity. */
export function uiNumericConvert(translator, value, destination, node = {}) {
  const source = value.legacyType;
  if (!numericNames.has(source) || !numericNames.has(destination)) {
    return translator.unsupported('this UI numeric conversion', node.syntax);
  }
  if (source === destination) return value;
  const boxed = translator.g.ui.intrinsic('ConvertNumeric', [value, n.literal(source, 'string'),
    n.literal(destination, 'string'), n.literal(!!node.isChecked, 'bool')], 'object');
  return translator.uiResult(translator.g.ui.intrinsic('Cast', [boxed, n.literal(destination, 'string')], 'object'), destination);
}

/** Nullable ABI constants use the same typed image encoding as the general scalar lowering. */
export function uiNumericLiteral(translator, value, type) {
  return n.literal(scalarImageConstant(value, type), type);
}
