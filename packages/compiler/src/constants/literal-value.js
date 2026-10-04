import {ConstantValue, Decimal} from './constant-value.js';

/** Adapt lossless lexer literal data to the compiler's immutable constant representation. */
export function literalConstant(literal) {
  const {type, value} = literal;
  if (type === 'decimal' && value && typeof value === 'object' && typeof value.mantissa === 'bigint') {
    return ConstantValue.decimal(new Decimal(value.mantissa, value.scale));
  }
  return ConstantValue.of(type, value);
}
