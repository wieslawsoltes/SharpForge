/**
 * Numeric conversions to and from `decimal`. CIL has no decimal on its evaluation stack: the language's numeric
 * conversion is a call of the conversion operator `System.Decimal` declares (`op_Implicit(int)`,
 * `op_Explicit(double)`, `op_Explicit(decimal)` returning `int`, ...). The operators come from the referenced core
 * library; the framework registry does not declare them, so without references the conversion stays unsupported.
 */
import { SymbolKind } from '../../symbols/types.js';

const isDecimal = type => type?.specialType === 'System_Decimal';
const conversionNames = ['op_Implicit', 'op_Explicit'];

/** The conversion operator of `decimal` from `from` to `to`, or null. */
function decimalOperator(decimal, from, to) {
  for (const name of conversionNames) {
    const found = decimal.getMembers(name).find(member => {
      const isOperator = member.kind === SymbolKind.Method && member.isStatic && member.parameters.length === 1;
      return isOperator && member.parameters[0].type.equals(from) && member.returnType.equals(to);
    });
    if (found) return found;
  }
  return null;
}

/** Class mixin: decimal conversions. */
export const DecimalConversionEmission = Base =>
  class extends Base {
    numericConversion(from, to, options = {}) {
      if (isDecimal(from) === isDecimal(to)) return super.numericConversion(from, to, options);
      const decimal = isDecimal(from) ? from : to,
        // An enum converts as its underlying type does.
        plain = type => (isDecimal(type) ? type : (type.enumUnderlyingType ?? type)),
        operator = decimalOperator(decimal, plain(from), plain(to));
      if (!operator) return super.numericConversion(from, to, options);
      return this.callMethod(operator, { syntax: options.syntax ?? null });
    }
    /** The standard conversion around a user-defined operator may be a numeric conversion to `decimal`. */
    implicitStandardConversion(from, to, syntax) {
      const isNumericToDecimal = from && to && isDecimal(to) && !isDecimal(from) && from.isValueType === true;
      return isNumericToDecimal ? this.numericConversion(from, to, { syntax }) : super.implicitStandardConversion(from, to, syntax);
    }
  };
