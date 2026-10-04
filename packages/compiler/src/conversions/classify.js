/**
 * Conversion classification (SF-A02-T06.1): the replacement for the string-typed `assignable`.
 *
 * `Conversions.classifyImplicit(from,to)` / `classifyExplicit(from,to)` classify a conversion between two types and
 * `classifyFromExpression(expression,to)` adds the conversions that depend on the expression (null and default
 * literals, constant narrowing, the 0-to-enum conversion, method groups, anonymous functions, interpolated strings,
 * tuple literals, throw). The result is an immutable `Conversion` whose `kind` follows Roslyn's ConversionKind.
 */
import { SymbolKind, TypeKind, NamedTypeSymbol, TypeParameterSymbol, TypeCompareKind } from '../symbols/types.js';
import { tupleElements } from '../symbols/tuple-elements.js';
import { numericKind, implicitNumericConversion, explicitNumericConversion } from './numeric.js';
import { implicitConstantConversion } from './constant-narrowing.js';
import { nativeIntegerKind, isNativeIdentity, isIntPtrFamily } from './native-int.js';
import { isNullableType, stripNullable, acceptsNullLiteral } from './nullable.js';
import { hasImplicitReferenceConversion, hasBoxingConversion, hasExplicitReferenceConversion, hasUnboxingConversion } from './reference.js';
import { resolveUserDefinedConversion } from './user-defined.js';
import { hasImplicitSpanConversion, hasExplicitSpanConversion } from './span.js';
import { hasInlineArrayConversion } from './inline-array.js';
import { pointerConversionKind, hasImplicitFunctionPointerConversion } from './pointer.js';
import { isInterpolatedStringHandlerType } from './interpolated-string-handler.js';

export const ConversionKind = Object.freeze(
  Object.fromEntries(
    [
      'NoConversion',
      'Identity',
      'ImplicitNumeric',
      'ImplicitEnumeration',
      'ImplicitNullable',
      'NullLiteral',
      'DefaultLiteral',
      'ImplicitReference',
      'Boxing',
      'ImplicitConstant',
      'ImplicitUserDefined',
      'ImplicitUnion',
      'ImplicitTuple',
      'ImplicitTupleLiteral',
      'InterpolatedString',
      'InterpolatedStringHandler',
      'MethodGroup',
      'AnonymousFunction',
      'ImplicitThrow',
      'ImplicitSpan',
      'InlineArray',
      'ImplicitDynamic',
      'ObjectCreation',
      'CollectionExpression',
      'ImplicitPointerToVoid',
      'ImplicitFunctionPointer',
      'ExplicitPointerToPointer',
      'ExplicitPointerToInteger',
      'ExplicitIntegerToPointer',
      'ExplicitNumeric',
      'ExplicitEnumeration',
      'ExplicitNullable',
      'ExplicitReference',
      'Unboxing',
      'ExplicitUserDefined',
      'ExplicitTuple',
      'ExplicitTupleLiteral',
      'ExplicitDynamic',
      'ExplicitSpan',
      'IntPtr',
    ].map(k => [k, k]),
  ),
);
const implicitKinds = new Set([
  'ImplicitPointerToVoid',
  'ImplicitFunctionPointer',
  'Identity',
  'ImplicitNumeric',
  'ImplicitEnumeration',
  'ImplicitNullable',
  'NullLiteral',
  'DefaultLiteral',
  'ImplicitReference',
  'Boxing',
  'ImplicitConstant',
  'ImplicitUserDefined',
  'ImplicitUnion',
  'ImplicitTuple',
  'ImplicitTupleLiteral',
  'InterpolatedString',
  'InterpolatedStringHandler',
  'MethodGroup',
  'AnonymousFunction',
  'ImplicitThrow',
  'ImplicitSpan',
  'InlineArray',
  'ImplicitDynamic',
  'ObjectCreation',
  'CollectionExpression',
]);
/** The classification of one conversion. `underlying` is the element conversion of a nullable/tuple conversion. */
export class Conversion {
  constructor(kind, extra = {}) {
    this.kind = kind;
    this.method = extra.method ?? null;
    this.underlying = extra.underlying ?? null;
    this.isLifted = !!extra.isLifted;
    this.isAmbiguous = !!extra.isAmbiguous;
    this.candidates = extra.candidates ?? null;
    this.error = extra.error ?? null;
    this.steps = extra.steps ?? null;
    // The bound handler pattern of an interpolated string handler conversion (binder/interpolated-string-handlers.js).
    this.handler = extra.handler ?? null;
    Object.freeze(this);
  }
  get exists() {
    return this.kind !== ConversionKind.NoConversion;
  }
  get isImplicit() {
    return implicitKinds.has(this.kind);
  }
  get isExplicit() {
    return this.exists && !this.isImplicit;
  }
  get isIdentity() {
    return this.kind === ConversionKind.Identity;
  }
  get isNumeric() {
    return this.kind === ConversionKind.ImplicitNumeric || this.kind === ConversionKind.ExplicitNumeric;
  }
  get isReference() {
    return this.kind === ConversionKind.ImplicitReference || this.kind === ConversionKind.ExplicitReference;
  }
  get isBoxing() {
    return this.kind === ConversionKind.Boxing;
  }
  get isUnboxing() {
    return this.kind === ConversionKind.Unboxing;
  }
  get isNullable() {
    return this.kind === ConversionKind.ImplicitNullable || this.kind === ConversionKind.ExplicitNullable;
  }
  get isUserDefined() {
    return this.kind === ConversionKind.ImplicitUserDefined || this.kind === ConversionKind.ExplicitUserDefined || this.kind === ConversionKind.ImplicitUnion;
  }
  get isStandard() {
    return this.exists && !this.isUserDefined;
  }
  toString() {
    return this.kind + (this.underlying ? '(' + this.underlying.kind + ')' : '') + (this.isLifted ? ' lifted' : '');
  }
}
const NONE = new Conversion(ConversionKind.NoConversion),
  IDENTITY = new Conversion(ConversionKind.Identity);
const make = kind => new Conversion(kind);
const K = ConversionKind;
const simple = Object.fromEntries(Object.keys(K).map(k => [k, make(k)]));
const isEnum = t => t.typeKind === TypeKind.Enum;
const isTuple = t => t instanceof NamedTypeSymbol && t.isTupleType && !t.isDefinition;

export class Conversions {
  /** @param core CoreTypes  @param {{numericIntPtr?:boolean,firstClassSpans?:boolean}} [options] language-version dependent rules (C# 11, C# 14) */
  constructor(core, options = {}) {
    this.core = core;
    this.options = options;
    this.standard = {
      implicit: (a, b) => {
        const c = this.classifyStandardImplicit(a, b);
        return c.exists && !c.isIdentity;
      },
      explicit: (a, b) => {
        const c = this.classifyStandardExplicit(a, b);
        return c.exists && !c.isIdentity;
      },
    };
  }
  /** C# 14 first-class spans: span conversions are standard conversions. */
  get firstClassSpans() {
    return this.options.firstClassSpans !== false;
  }
  static noConversion = NONE;
  static identity = IDENTITY;
  kindOf(type) {
    return nativeIntegerKind(type, this.options) ?? numericKind(type);
  }
  isIdentity(from, to) {
    return (
      from.equals(
        to,
        TypeCompareKind.IgnoreTupleNames | TypeCompareKind.IgnoreDynamic | TypeCompareKind.IgnoreNullableModifiersForReferenceTypes,
      ) ||
      (isNativeIdentity(from, to) && from.equals(to, TypeCompareKind.IgnoreNativeIntegers))
    );
  }
  /** Standard implicit conversions only (no user-defined operators): identity, numeric, nullable, reference, boxing, tuple, span. */
  classifyStandardImplicit(from, to) {
    if (!from || !to || from.isErrorType() || to.isErrorType()) return NONE;
    if (this.isIdentity(from, to)) return IDENTITY;
    const a = this.kindOf(from),
      b = this.kindOf(to);
    if (a && b) {
      if (a === b) return IDENTITY;
      if (implicitNumericConversion(a, b)) return simple.ImplicitNumeric;
    }
    if (isNullableType(to) && to.isValueType) {
      const inner = this.classifyStandardImplicit(stripNullable(from), stripNullable(to));
      if (inner.exists && (inner.isIdentity || inner.kind === K.ImplicitNumeric || inner.kind === K.ImplicitTuple))
        return new Conversion(K.ImplicitNullable, { underlying: inner, steps: isNullableType(from) ? ['lift'] : ['wrap'] });
    }
    if (from.typeKind === TypeKind.Dynamic) return simple.ImplicitDynamic;
    if (pointerConversionKind(from, to, t => this.kindOf(t)) === K.ImplicitPointerToVoid) return simple.ImplicitPointerToVoid;
    if (hasImplicitFunctionPointerConversion(from, to, this)) return simple.ImplicitFunctionPointer;
    if (hasImplicitReferenceConversion(from, to, this.core)) return simple.ImplicitReference;
    if (hasBoxingConversion(from, to, this.core)) return simple.Boxing;
    if (isTuple(from) && isTuple(to) && tupleElements(from).length === tupleElements(to).length) {
      const parts = tupleElements(from).map((x, i) => this.classifyImplicit(x.type, tupleElements(to)[i].type));
      if (parts.every(p => p.exists && p.isImplicit)) return new Conversion(K.ImplicitTuple, { underlying: parts });
    }
    if (this.firstClassSpans && hasImplicitSpanConversion(from, to, this.core)) return simple.ImplicitSpan;
    return NONE;
  }
  /** Standard explicit conversions (the implicit ones included). */
  classifyStandardExplicit(from, to) {
    const implicit = this.classifyStandardImplicit(from, to);
    if (implicit.exists) return implicit;
    if (!from || !to || from.isErrorType() || to.isErrorType()) return NONE;
    const a = this.kindOf(from),
      b = this.kindOf(to);
    if (a && b && explicitNumericConversion(a, b)) return simple.ExplicitNumeric;
    const pointer = pointerConversionKind(from, to, t => this.kindOf(t));
    if (pointer) return simple[pointer];
    // Enumerations convert explicitly to and from every numeric type and each other.
    if ((isEnum(from) && (b || isEnum(to))) || (isEnum(to) && a)) return simple.ExplicitEnumeration;
    if (isNullableType(from) || isNullableType(to)) {
      const inner = this.classifyStandardExplicit(stripNullable(from), stripNullable(to));
      if (
        inner.exists &&
        [K.Identity, K.ImplicitNumeric, K.ExplicitNumeric, K.ExplicitEnumeration, K.ImplicitTuple, K.ExplicitTuple].includes(inner.kind)
      )
        return new Conversion(K.ExplicitNullable, {
          underlying: inner,
          steps: isNullableType(from) && isNullableType(to) ? ['lift'] : isNullableType(to) ? ['wrap'] : ['unwrap'],
        });
    }
    if (to.typeKind === TypeKind.Dynamic) return simple.ExplicitDynamic;
    if (hasExplicitReferenceConversion(from, to, this.core)) return simple.ExplicitReference;
    if (hasUnboxingConversion(from, to, this.core)) return simple.Unboxing;
    if (isTuple(from) && isTuple(to) && tupleElements(from).length === tupleElements(to).length) {
      const parts = tupleElements(from).map((x, i) => this.classifyExplicit(x.type, tupleElements(to)[i].type));
      if (parts.every(p => p.exists)) return new Conversion(K.ExplicitTuple, { underlying: parts });
    }
    if (this.firstClassSpans && hasExplicitSpanConversion(from, to, this.core)) return simple.ExplicitSpan;
    // Before C# 11 plain IntPtr/UIntPtr convert through their own operators; they are classified as IntPtr conversions.
    if (((isIntPtrFamily(from) && (b || isEnum(to))) || (isIntPtrFamily(to) && (a || isEnum(from)))) && !(a && b)) return simple.IntPtr;
    return NONE;
  }
  /** Implicit conversion between types, user-defined operators included. */
  classifyImplicit(from, to) {
    const standard = this.classifyStandardImplicit(from, to);
    if (standard.exists) return standard;
    if (!from || !to || from.isErrorType() || to.isErrorType()) return NONE;
    return this.userDefined(from, to, false);
  }
  /** Explicit (cast) conversion between types: standard implicit, user-defined implicit, standard explicit, user-defined explicit. */
  classifyExplicit(from, to) {
    const implicit = this.classifyImplicit(from, to);
    if (implicit.exists) return implicit;
    if (!from || !to || from.isErrorType() || to.isErrorType()) return NONE;
    const standard = this.classifyStandardExplicit(from, to);
    if (standard.exists) return standard;
    return this.userDefined(from, to, true);
  }
  /**
   * @param {object|null} [constant] the value of the converted expression when it is an integral constant: the standard
   *   conversion to the parameter type of an operator is then that of the expression (`Natural n = 1` through
   *   `implicit operator Natural(ulong)`: the constant 1 converts to `ulong`, the type `int` does not).
   */
  userDefined(from, to, explicit, constant = null) {
    if (from.typeKind === TypeKind.Interface && to.typeKind === TypeKind.Interface) return NONE;
    // Where a span conversion exists (here: only explicitly), the operators of the span types are not considered.
    if (this.firstClassSpans && hasExplicitSpanConversion(from, to, this.core)) return NONE;
    const standard = constant ? this.standardFromConstant(from, constant) : this.standard,
      found = resolveUserDefinedConversion(from, to, { explicit }, standard, this.core);
    if (!found) return NONE;
    if (found.ambiguous)
      return explicit
        ? new Conversion(K.ExplicitUserDefined, { isAmbiguous: true, candidates: found.candidates })
        : implicitAmbiguity(found);
    if (!explicit && !found.isImplicit) return NONE;
    return new Conversion(found.isImplicit ? K.ImplicitUserDefined : K.ExplicitUserDefined, {
      method: found.method,
      isLifted: found.isLifted,
    });
  }
  /**
   * An expression whose conversion depends on its form (`null`, a tuple literal) converted through an implicit
   * operator of the target type: `Tri t = null` with `implicit operator Tri(bool? b)`, `Vec2 v = (1, 2)` with
   * `implicit operator Vec2((double X, double Y) t)`. The operators of the target type are the candidates, and the
   * expression must convert to the parameter type by a standard conversion (C# spec 10.5.4).
   */
  userDefinedFromExpression(expression, to) {
    const target = stripNullable(to);
    if ((target.typeKind !== TypeKind.Struct && target.typeKind !== TypeKind.Class) || !target.getMembers) return NONE;
    const isConversion = method => method.kind === SymbolKind.Method && method.parameters.length === 1 && !!method.returnType?.equals(target),
      takes = type => {
        if (expression.literal === 'null') return isNullableType(type) || acceptsNullLiteral(type);
        const standard = type.isTupleType ? this.classifyFromExpression(expression, type) : NONE;
        return standard.exists && standard.isImplicit && !standard.isUserDefined;
      },
      operators = target.getMembers('op_Implicit').filter(method => isConversion(method) && takes(method.parameters[0].type));
    return operators.length === 1 ? new Conversion(K.ImplicitUserDefined, { method: operators[0], isLifted: false }) : NONE;
  }
  /** The standard conversion tests with the implicit constant expression conversions of one constant of type `from`. */
  standardFromConstant(from, constant) {
    const sourceKind = this.kindOf(from),
      fits = to => {
        const targetKind = this.kindOf(to);
        return !!sourceKind && !!targetKind && implicitConstantConversion(sourceKind, constant.bigint, targetKind);
      };
    return { ...this.standard, implicit: (a, b) => this.standard.implicit(a, b) || (a === from && fits(b)) };
  }
  /**
   * Implicit conversion of an expression to a type.
   * @param expression `{type, constantValue?, literal?:'null'|'default',
   *   form?:'methodGroup'|'lambda'|'interpolatedString'|'throw'|'tupleLiteral'|'implicitNew'|'collection', convert?:(to)=>Conversion|null,
   *   elements?:[expression]}`
   */
  classifyFromExpression(expression, to) {
    if (!to || to.isErrorType()) return NONE;
    switch (expression.literal) {
      case 'null':
        // As in Roslyn, null to a reference type is an implicit reference conversion; only T? takes the null literal conversion.
        if (isNullableType(to)) return simple.NullLiteral;
        if (acceptsNullLiteral(to) || (to instanceof TypeParameterSymbol && to.isReferenceType === true)) return simple.ImplicitReference;
        return to.typeKind === TypeKind.Struct ? this.userDefinedFromExpression(expression, to) : NONE;
      case 'default':
        return simple.DefaultLiteral;
    }
    switch (expression.form) {
      case 'throw':
        return simple.ImplicitThrow;
      case 'methodGroup':
      case 'methodAddress':
      case 'lambda':
      case 'implicitNew':
      case 'collection': {
        const c = expression.convert?.(to);
        return c ?? NONE;
      }
      case 'tupleLiteral': {
        // A literal of exactly the target type is an identity; otherwise its elements convert one by one.
        if (expression.type && this.isIdentity(expression.type, to)) return IDENTITY;
        const literal = this.tupleLiteralConversion(expression, stripNullable(to), false);
        if (literal) return isNullableType(to) ? new Conversion(K.ImplicitNullable, { underlying: literal, steps: ['wrap'] }) : literal;
        if (!stripNullable(to).isTupleType) {
          const viaOperator = this.userDefinedFromExpression(expression, to);
          if (viaOperator.exists) return viaOperator;
        }
        if (!expression.type) return NONE;
        break;
      }
      case 'interpolatedString':
        if (['FormattableString', 'IFormattable'].includes(to.name) && to.containingNamespace?.name === 'System')
          return simple.InterpolatedString;
        if (isInterpolatedStringHandlerType(to)) return simple.InterpolatedStringHandler;
        break;
    }
    const from = expression.type;
    if (!from) return NONE;
    if (hasInlineArrayConversion(from, to, this)) return simple.InlineArray;
    const constant = expression.constantValue;
    // Roslyn classifies an int constant converted to nint as a constant conversion, not as the numeric one.
    if (constant?.isIntegral && !constant.isEnum && this.kindOf(from) === 'int' && this.kindOf(to) === 'nint' && !this.isIdentity(from, to))
      return simple.ImplicitConstant;
    const typed = this.classifyStandardImplicit(from, to);
    if (typed.exists) return typed;
    if (constant && !constant.isNull) {
      const target = stripNullable(to),
        a = this.kindOf(from),
        b = this.kindOf(target),
        wrap = c => (target === to ? c : new Conversion(K.ImplicitNullable, { underlying: c, steps: ['wrap'] }));
      // The literal 0 (any numeric constant zero, as Roslyn accepts) converts to every enum type.
      if (isEnum(target) && a && !constant.isEnum && isZero(constant)) return simple.ImplicitEnumeration;
      if (
        a &&
        b &&
        constant.isIntegral &&
        !constant.isEnum &&
        constant.type !== 'char' &&
        implicitConstantConversion(a, constant.bigint, b)
      )
        return wrap(simple.ImplicitConstant);
    }
    const integral = constant && !constant.isNull && constant.isIntegral && !constant.isEnum && constant.type !== 'char' ? constant : null;
    return this.userDefined(from, to, false, integral);
  }
  /** Explicit conversion of an expression (a cast): the expression-based implicit conversions, then `classifyExplicit`. */
  classifyCastFromExpression(expression, to) {
    const implicit = this.classifyFromExpression(expression, to);
    if (implicit.exists) return implicit;
    if (to && !to.isErrorType() && expression.form === 'tupleLiteral') {
      const literal = this.tupleLiteralConversion(expression, stripNullable(to), true);
      if (literal) return isNullableType(to) ? new Conversion(K.ExplicitNullable, { underlying: literal, steps: ['wrap'] }) : literal;
    }
    return expression.type ? this.classifyExplicit(expression.type, to) : NONE;
  }
  /**
   * The element-wise conversion of a tuple literal to the tuple type `target`: ImplicitTupleLiteral when every element
   * converts implicitly, ExplicitTupleLiteral (casts only) when every element converts at all, otherwise null.
   */
  tupleLiteralConversion(expression, target, forCast) {
    if (!isTuple(target) || tupleElements(target).length !== expression.elements.length) return null;
    const classify = (element, type) => (forCast ? this.classifyCastFromExpression(element, type) : this.classifyFromExpression(element, type));
    const parts = expression.elements.map((element, index) => classify(element, tupleElements(target)[index].type));
    if (!parts.every(part => part.exists)) return null;
    const isImplicit = parts.every(part => part.isImplicit);
    if (!isImplicit && !forCast) return null;
    return new Conversion(isImplicit ? K.ImplicitTupleLiteral : K.ExplicitTupleLiteral, { underlying: parts });
  }
  hasImplicit(from, to) {
    return this.classifyImplicit(from, to).exists;
  }
  /** Identity or implicit reference conversion: the relation variance, array covariance and delegate compatibility use. */
  hasIdentityOrReference(from, to) {
    return this.isIdentity(from, to) || hasImplicitReferenceConversion(from, to, this.core);
  }
}
const isZero = c => (c.type === 'decimal' ? c.value.mantissa === 0n : c.isIntegral ? c.bigint === 0n : c.isFloatingPoint && c.value === 0);
const implicitAmbiguity = found => new Conversion(K.ImplicitUserDefined, { isAmbiguous: true, candidates: found.candidates });
