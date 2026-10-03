import {ConstantValue, Decimal} from '../../constants/constant-value.js';

/** Convert the scanner's exact numeric payload at the syntax/constant-model boundary. */
export function bindNumericLiteral(binder, syntax) {
  const literal = syntax.token.value;
  if (!literal?.type) return binder.bad(syntax);
  let value = literal.value;
  try {
    // The scanner cannot depend on the compiler's Decimal class. Preserve its
    // coefficient and scale directly instead of parsing a host object or Number.
    if (literal.type === 'decimal' && value && typeof value.mantissa === 'bigint') {
      value = new Decimal(value.mantissa, value.scale);
    }
    const constant = ConstantValue.of(literal.type, value);
    const node = binder.node('Literal', syntax, binder.core.keyword(literal.type));
    node.constantValue = constant;
    return node;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Invalid literal ranges already have a scanner diagnostic; do not publish
    // a valid-looking Literal whose constant silently disappeared.
    return binder.bad(syntax);
  }
}
