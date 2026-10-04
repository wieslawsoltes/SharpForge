/**
 * C# 15 union conversions (unions.md revision 1). A union conversion is not standard and cannot be chained
 * through another union or user-defined conversion. Applicable conversion operators retain precedence.
 */
import { Conversion, ConversionKind, Conversions } from './classify.js';
import { isNullableType } from './nullable.js';
import { OverloadResolver } from '../overload/resolution.js';
import { unionShapeOf } from '../symbols/union-shape.js';
import { Accessibility } from '../symbols/types.js';
import { checkConstructorAccess, isAccessible } from '../binder/accessibility.js';

/** The argument-to-case stage must contain only standard conversions, including within tuples. */
class UnionArgumentConversions extends Conversions {
  userDefined() { return Conversions.noConversion; }
  userDefinedFromExpression() { return Conversions.noConversion; }
}

const standardOnly = conversion => conversion.exists && conversion.isImplicit && conversion.isStandard &&
  (Array.isArray(conversion.underlying) ? conversion.underlying.every(standardOnly) :
    !conversion.underlying || standardOnly(conversion.underlying));

/** The semantic classifier with the preview-only union conversion family. */
export class UnionConversions extends Conversions {
  constructor(core, options = {}) {
    super(core, options);
    this.unionArguments = null;
    this.unionOverloads = null;
  }
  unionConversion(expression, to) {
    if (!this.options.unionPreview || !to || to.isErrorType?.()) return Conversions.noConversion;
    const shape = unionShapeOf(to, this.core);
    if (!shape?.valid) return Conversions.noConversion;
    this.unionArguments ??= new UnionArgumentConversions(this.core, this.options);
    this.unionOverloads ??= new OverloadResolver(this.unionArguments, this.core);
    const applicable = shape.creationMembers.filter(member =>
      standardOnly(this.unionArguments.classifyFromExpression(expression, member.parameters[0].type)));
    if (!applicable.length) return Conversions.noConversion;
    const context = expression.unionConversionContext;
    const candidates = shape.candidates.filter(member => {
      if (!context) return member.declaredAccessibility === Accessibility.Public;
      const options = { withinModule: context.module };
      return shape.provider ? isAccessible(member, context.within, options) : !checkConstructorAccess(member, context.within, options);
    });
    const resolution = this.unionOverloads.resolve(candidates, [expression], { isConstructor: !shape.provider });
    if (!resolution.succeeded) return new Conversion(ConversionKind.ImplicitUnion, {
      isAmbiguous: true, candidates: applicable, error: resolution.error,
    });
    if (!shape.creationMembers.some(member => member.equals(resolution.method))) return new Conversion(ConversionKind.ImplicitUnion, {
      isAmbiguous: true, candidates: [resolution.method], error: { unionMemberRequired: true },
    });
    return new Conversion(ConversionKind.ImplicitUnion, {
      method: resolution.method, isLifted: isNullableType(to),
      underlying: this.unionArguments.classifyFromExpression(expression, resolution.method.parameters[0].type),
    });
  }
  classifyImplicit(from, to) {
    const conversion = super.classifyImplicit(from, to);
    return conversion.exists || !this.options.unionPreview ? conversion : this.unionConversion({ type: from }, to);
  }
  classifyFromExpression(expression, to) {
    const conversion = super.classifyFromExpression(expression, to);
    return conversion.exists ? conversion : this.unionConversion(expression, to);
  }
  classifyExplicit(from, to) {
    if (!this.options.unionPreview || !unionShapeOf(to, this.core)) return super.classifyExplicit(from, to);
    const standard = this.classifyStandardImplicit(from, to);
    if (standard.exists || !from || from.isErrorType()) return standard;
    const implicitOperator = this.userDefined(from, to, false);
    if (implicitOperator.exists) return implicitOperator;
    const explicitStandard = this.classifyStandardExplicit(from, to);
    if (explicitStandard.exists) return explicitStandard;
    const explicitOperator = this.userDefined(from, to, true);
    return explicitOperator.exists ? explicitOperator : this.unionConversion({ type: from }, to);
  }
  classifyCastFromExpression(expression, to) {
    if (!this.options.unionPreview || !unionShapeOf(to, this.core)) return super.classifyCastFromExpression(expression, to);
    const implicit = super.classifyFromExpression(expression, to);
    if (implicit.exists) return implicit;
    if (expression.type) {
      const explicitStandard = this.classifyStandardExplicit(expression.type, to);
      if (explicitStandard.exists) return explicitStandard;
      const explicitOperator = this.userDefined(expression.type, to, true, expression.constantValue?.isIntegral ? expression.constantValue : null);
      if (explicitOperator.exists) return explicitOperator;
    }
    return this.unionConversion(expression, to);
  }
}

/** True when a conversion constructs the target union directly, possibly followed by a nullable wrapper. */
export const isUnionConversion = conversion => conversion?.kind === ConversionKind.ImplicitUnion;
