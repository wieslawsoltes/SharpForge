/** Execution-profile conversions supported by typed scalar and memory bytecode. */
import { Conversions, Conversion, ConversionKind } from './classify.js';
import { ErrorTypeSymbol, ArrayTypeSymbol } from '../symbols/types.js';

const none = Conversions.noConversion;
const nullLiteral = new Conversion(ConversionKind.NullLiteral);
const boxing = new Conversion(ConversionKind.Boxing);
const targetTypedForms = new Set(['methodGroup', 'implicitNew', 'collection']);

/** True when the type or the element type of an array of it is an error type. */
function isErroneous(type) {
  if (type instanceof ArrayTypeSymbol) return isErroneous(type.elementType);
  return type instanceof ErrorTypeSymbol;
}

/** True when an argument has a type of its own: not the null literal, not target-typed and not erroneous. */
export function hasNaturalType(argument) {
  return argument.literal !== 'null' && !!argument.type && !isErroneous(argument.type);
}

export class ExecutionProfileConversions extends Conversions {
  /** @param core CoreTypes over the registry bridge */
  constructor(core) {
    super(core, { numericIntPtr: true, firstClassSpans: true });
    this.nonNullable = new Set([core.void]);
  }

  /** True when `type` is `to` or derives from it through base classes. */
  derivesFrom(type, to) {
    for (let current = type, depth = 0; current && depth < 64; current = current.baseType, depth++) {
      if (current === to) return true;
    }
    return false;
  }

  /** Whether the back end can pass a value of type `from` where `to` is expected after `conversion`. */
  isEmittable(from, to, conversion) {
    switch (conversion.kind) {
      case ConversionKind.Identity:
        return true;
      case ConversionKind.ImplicitNumeric:
      case ConversionKind.ImplicitConstant:
      case ConversionKind.ImplicitSpan:
        return true;
      case ConversionKind.Boxing:
        return !from.isRefLikeType && to === this.core.object;
      case ConversionKind.ImplicitReference:
        return to === this.core.object || this.derivesFrom(from, to);
      default:
        return false;
    }
  }

  classifyFromExpression(expression, to) {
    if (!to) return none;
    if (expression.literal === 'null') return to.isValueType || this.nonNullable.has(to) ? none : nullLiteral;
    if (targetTypedForms.has(expression.form)) return expression.convert?.(to) ?? none;
    const from = expression.type;
    if (!from || from === this.core.void) return none;
    if (isErroneous(from)) return to === this.core.object ? boxing : none;
    const conversion = super.classifyFromExpression(expression, to);
    return conversion.exists && this.isEmittable(from, to, conversion) ? conversion : none;
  }
}
