/**
 * Argument conversions of the execution profile (SF-A02-T19).
 *
 * The execution binder passes arguments to framework members without conversion instructions except the widening
 * of `int` to `double`, so overload resolution over the framework symbols may only use the conversions that back
 * end can perform. `ExecutionProfileConversions` classifies with `Conversions` and keeps a result only when it is
 * one of those: identity, `int` to `double`, the null literal, a reference conversion to a base class, and any
 * conversion to `object`, and registry-proven interface upcasts between registered types.
 *
 * Two rules of the string-typed profile are wider than C# and are kept so that programs it accepted keep
 * compiling to the same image:
 *  - the null literal converts to every framework type that is not `int`, `double`, `bool` or `void` (the
 *    registry does not separate framework value types from classes at the ABI);
 *  - an argument whose type is an error type converts to `object`, so the error already reported for the
 *    argument is not followed by an overload diagnostic.
 */
import { Conversions, Conversion, ConversionKind } from './classify.js';
import { ErrorTypeSymbol, ArrayTypeSymbol } from '../symbols/types.js';
import { isRegisteredReferenceUpcast } from './registered-reference.js';

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
    super(core, { numericIntPtr: false, firstClassSpans: false });
    this.nonNullable = new Set([core.int, core.double, core.bool, core.void]);
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
        return from === this.core.int && to === this.core.double;
      case ConversionKind.Boxing:
        return to === this.core.object;
      case ConversionKind.ImplicitReference:
        return to === this.core.object || this.derivesFrom(from, to) ||
          isRegisteredReferenceUpcast(this.core.bridge.registryName(from), this.core.bridge.registryName(to));
      default:
        return false;
    }
  }

  classifyFromExpression(expression, to) {
    if (!to) return none;
    if (expression.literal === 'null') return this.nonNullable.has(to) ? none : nullLiteral;
    if (targetTypedForms.has(expression.form)) return expression.convert?.(to) ?? none;
    const from = expression.type;
    if (!from || from === this.core.void) return none;
    if (isErroneous(from)) return to === this.core.object ? boxing : none;
    const conversion = this.classifyStandardImplicit(from, to);
    return conversion.exists && this.isEmittable(from, to, conversion) ? conversion : none;
  }
}
