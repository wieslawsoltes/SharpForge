/** Union conversion materialization and pattern value sources, from the pinned unions.md revision 1. */
import { previewStampText } from '@sharpforge/syntax';
import { DiagnosticId } from '../../diagnostics/codes.js';
import { ConversionKind } from '../../conversions/classify.js';
import { isUnionConversion } from '../../conversions/unions.js';
import { stripNullable } from '../../conversions/nullable.js';
import { typeTestOutcome } from '../../conversions/reference.js';
import { RefKind, TypeKind } from '../../symbols/types.js';
import { MethodKind } from '../../symbols/members.js';
import { isUnionType, unionShapeOf, unionShapeRules } from '../../symbols/union-shape.js';
import { narrowedTypeOf } from '../body/patterns.js';
import { checkUnionSwitchArms } from '../../flow/union-pattern-spaces.js';

const unwrappedKinds = new Set(['TypePattern', 'DeclarationPattern', 'ConstantPattern', 'RelationalPattern']);
const nonNumericPatternConversions = new Set([
  ConversionKind.Identity, ConversionKind.ImplicitReference, ConversionKind.ExplicitReference,
  ConversionKind.Boxing, ConversionKind.Unboxing,
]);
const nonBoxingConversions = new Set([ConversionKind.Identity, ConversionKind.ImplicitReference]);

/** Whether a known case can contain a value matched by a type pattern (numeric and user conversions do not count). */
export function unionPatternCompatible(caseType, testedType, conversions, core) {
  if (caseType.typeKind === TypeKind.TypeParameter || testedType.typeKind === TypeKind.TypeParameter) return true;
  if (typeTestOutcome(caseType, testedType, core) !== 'never') return true;
  const conversion = conversions.classifyStandardExplicit(caseType, testedType);
  return conversion.exists && nonNumericPatternConversions.has(conversion.kind);
}

/** Type of the output value; null/not/or preserve the union instance, even when a child unwraps it. */
export function unionPatternOutputType(pattern, inputType) {
  if (pattern.kind === 'AndPattern') return unionPatternOutputType(pattern.right, unionPatternOutputType(pattern.left, inputType));
  if (pattern.kind === 'OrPattern') return pattern.narrowedType ?? inputType;
  if (pattern.unionAccess && !pattern.unionAccess.isNull)
    return pattern.testedType ?? pattern.value?.type ?? narrowedTypeOf(pattern, inputType);
  return narrowedTypeOf(pattern, inputType);
}

function changesUnionContents(pattern) {
  if (pattern.unionAccess) return !pattern.unionAccess.isNull;
  return pattern.kind === 'AndPattern' && (changesUnionContents(pattern.left) || changesUnionContents(pattern.right));
}

function accessPlan(binder, shape, pattern) {
  const isNull = pattern.kind === 'ConstantPattern' &&
    (pattern.value?.literal === 'null' || pattern.value?.constantValue?.isNull);
  const testedType = pattern.testedType ?? (isNull ? null : pattern.value?.type);
  if (isNull && shape.hasValue) return { shape, isNull, kind: 'hasValue', member: shape.hasValue, outputType: binder.core.bool };
  if (testedType) {
    const applicable = shape.tryGetValues.map(member => ({ member,
      conversion: binder.conversions.classifyStandardImplicit(testedType, member.parameters[0].type) }))
      .filter(row => nonBoxingConversions.has(row.conversion.kind) || row.conversion.isBoxing);
    const selected = applicable.find(row => !row.conversion.isBoxing) ?? applicable[0];
    if (selected) return { shape, isNull, kind: 'tryGet', member: selected.member, outputType: selected.member.parameters[0].type };
  }
  return { shape, isNull, kind: 'value', member: shape.valueProperty, outputType: binder.core.object };
}

/** Body-binder registration for union behaviors. */
export const UnionBinding = Base => class extends Base {
  constructor(...args) {
    super(...args);
    this.unionConversionContext = this.version.preview ? { within: this.c.containingType, module: this.d.assembly.module } : null;
  }
  node(...args) {
    const result = super.node(...args);
    if (this.unionConversionContext) result.unionConversionContext = this.unionConversionContext;
    return result;
  }
  unionShape(type, syntax) {
    if (!this.version.preview) return null;
    const shape = unionShapeOf(type, this.core);
    if (!shape) return null;
    if (!shape.valid || shape.hasUnresolvedAccessPattern) {
      const unresolved = shape.hasUnresolvedAccessPattern || shape.problems.includes('basicPattern');
      const detail = shape.hasUnresolvedAccessPattern ? 'inherited, hidden or read-write non-boxing union API lookup'
        : unresolved ? 'custom unions missing the basic union pattern' : unionShapeRules[shape.problems[0]];
      this.report(syntax, unresolved ? DiagnosticId.SF2202 : DiagnosticId.SF2203, [detail, previewStampText('Unions')]);
      return null;
    }
    return shape;
  }
  bindType(syntax, options) {
    const result = super.bindType(syntax, options);
    const shape = this.version.preview ? unionShapeOf(result.type, this.core) : null;
    if (shape && !shape.valid) this.unionShape(result.type, syntax);
    return result;
  }
  applyConversion(expression, type, conversion, syntax = expression.syntax, isExplicit = false) {
    if (!isUnionConversion(conversion)) return super.applyConversion(expression, type, conversion, syntax, isExplicit);
    if (conversion.isAmbiguous || !conversion.method) {
      this.reportConversionFailure(expression, type, syntax, conversion);
      return this.bad(syntax, { operand: expression });
    }
    const member = conversion.method;
    const parameter = member.parameters[0];
    const argument = this.applyConversion(expression, parameter.type, conversion.underlying, syntax);
    const args = [{ expression: argument, type: parameter.type, parameter, refKind: RefKind.None }];
    const target = stripNullable(type);
    const operation = member.methodKind === MethodKind.Constructor
      ? this.node('ObjectCreation', syntax, target, { constructor: member, args, unionCreation: true })
      : this.node('Call', syntax, target, { method: member, receiver: null, args, constrainedTo: target, unionCreation: true });
    if (!this.quiet) this.d.noteUse?.(member, this.c.uri, syntax);
    // Keep the source conversion visible to semantic queries. As for a compound assignment, `operation` is the
    // separately bound execution plan; generic walks visit the original operand once instead of duplicating it.
    return this.node('Conversion', syntax, type, { operand: expression, conversion, operation, isExplicit });
  }
  reportConversionFailure(expression, type, syntax, conversion) {
    if (!isUnionConversion(conversion)) return super.reportConversionFailure(expression, type, syntax, conversion);
    if (conversion.error?.unionMemberRequired) {
      this.report(syntax, DiagnosticId.SF2203, ['overload resolution must select a union creation member', previewStampText('Unions')]);
      return;
    }
    if (conversion.error?.code) this.report(syntax, conversion.error.code, conversion.error.args);
    else super.reportConversionFailure(expression, type, syntax, conversion);
  }
  pattern(syntax, inputType, input) {
    if (!this.version.preview || !isUnionType(inputType)) return super.pattern(syntax, inputType, input);
    const shape = this.unionShape(inputType, syntax);
    if (!shape) return { kind: syntax.kind, syntax, hasErrors: true };
    if (syntax.kind === 'OrPattern') {
      const left = this.pattern(syntax.left, inputType, input);
      const right = this.pattern(syntax.right, inputType, input);
      const leftType = changesUnionContents(left) ? inputType : unionPatternOutputType(left, inputType);
      const rightType = changesUnionContents(right) ? inputType : unionPatternOutputType(right, inputType);
      const narrowedType = leftType.equals(rightType) || this.conversions.classifyStandardImplicit(rightType, leftType).exists ? leftType
        : this.conversions.classifyStandardImplicit(leftType, rightType).exists ? rightType : inputType;
      return { kind: 'OrPattern', syntax, left, right, narrowedType };
    }
    if (syntax.kind === 'AndPattern') {
      const left = this.pattern(syntax.left, inputType, input);
      const narrowedType = unionPatternOutputType(left, inputType);
      return { kind: 'AndPattern', syntax, left, right: this.pattern(syntax.right, narrowedType, input),
        narrowedType, unionValueSource: true };
    }
    const unwrap = unwrappedKinds.has(syntax.kind) || syntax.kind === 'RecursivePattern' && syntax.type;
    if (!unwrap) return super.pattern(syntax, inputType, input);
    const pattern = super.pattern(syntax, syntax.kind === 'RelationalPattern' ? null : this.core.object, input);
    return this.finishUnionPattern(pattern, shape, inputType);
  }
  finishUnionPattern(pattern, shape, inputType) {
    const testedType = pattern.testedType ?? pattern.value?.type;
    const isNull = pattern.value?.literal === 'null' || pattern.value?.constantValue?.isNull;
    if (testedType && !isNull && !shape.caseTypes.some(type => unionPatternCompatible(type, testedType, this.conversions, this.core))) {
      this.report(pattern.syntax.type ?? pattern.syntax, DiagnosticId.CS8121, [this.display(inputType), this.display(testedType)]);
      pattern.hasErrors = true;
    }
    pattern.unionAccess = accessPlan(this, shape, pattern);
    return pattern;
  }
  typeTest(syntax, operand, type) {
    if (!this.version.preview || !isUnionType(operand.type)) return super.typeTest(syntax, operand, type);
    const shape = this.unionShape(operand.type, syntax);
    if (!shape) return this.bad(syntax);
    const pattern = this.finishUnionPattern(super.typePattern(syntax, type, this.core.object), shape, operand.type);
    return this.node('IsPattern', syntax, this.core.bool, { operand, pattern });
  }
  tryConstantPattern(syntax, operand) {
    if (!this.version.preview || !isUnionType(operand.type)) return super.tryConstantPattern(syntax, operand);
    const shape = this.unionShape(operand.type, syntax);
    if (!shape) return null;
    const pattern = super.tryConstantPattern(syntax, { ...operand, type: this.core.object });
    return pattern ? this.finishUnionPattern(pattern, shape, operand.type) : null;
  }
  gotoSection(syntax, enclosing) {
    const type = enclosing.governing?.type;
    if (syntax.kind !== 'GotoCaseStatement' || !this.version.preview || !isUnionType(type)) return super.gotoSection(syntax, enclosing);
    const value = this.value(syntax.expression);
    if (value.hasErrors) return null;
    if (!value.constantValue) {
      this.report(syntax, DiagnosticId.CS0150);
      return null;
    }
    const shape = this.unionShape(type, syntax.expression);
    if (!shape) return null;
    const pattern = this.finishUnionPattern({ kind: 'ConstantPattern', syntax: syntax.expression, value }, shape, type);
    if (pattern.hasErrors) return null;
    const targets = (enclosing.gotoTargets ??= this.switchTargets(enclosing));
    const section = targets.cases.get(value.constantValue.toString());
    if (section !== undefined) return section;
    const label = value.constantValue.isNull ? 'null' : value.constantValue.displayValue;
    this.report(syntax, DiagnosticId.CS0159, [`case ${label}:`]);
    return null;
  }
  propertySubpattern(syntax, inputType) {
    const result = super.propertySubpattern(syntax, inputType);
    if (this.version.preview && isUnionType(inputType) && result.member?.name === 'Value') {
      // Open question "Should direct Value property matching follow Union rules?", pinned lines 831-861.
      const shape = unionShapeOf(inputType, this.core);
      result.unionValueShape = shape;
      const pending = [result.pattern];
      while (pending.length) {
        const pattern = pending.pop();
        if (!pattern) continue;
        const tested = pattern.testedType ?? (pattern.value?.constantValue?.isNull ? null : pattern.value?.type);
        if (tested && !shape.caseTypes.some(type => unionPatternCompatible(type, tested, this.conversions, this.core))) {
          this.report(syntax, DiagnosticId.SF2202, ['case compatibility for direct Value property matching', previewStampText('Unions')]);
          break;
        }
        // Only logical children keep this Value input. Property and positional children have their own member types.
        for (const child of [pattern.left, pattern.right, pattern.pattern]) if (child) pending.push(child);
      }
    }
    return result;
  }
  reportSwitchArms(type, arms, site) {
    if (this.version.preview && !arms.some(arm => arm.isDefault || ['DiscardPattern', 'VarPattern'].includes(arm.pattern?.kind))) {
      const pending = arms.map(arm => arm.pattern).filter(Boolean);
      while (pending.length) {
        const pattern = pending.pop();
        if (pattern.properties?.some(property => property.unionValueShape)) {
          this.report(site.node, DiagnosticId.SF2202, ['exhaustiveness of direct Value property patterns', previewStampText('Unions')]);
          break;
        }
        for (const child of [pattern.left, pattern.right, pattern.pattern]) if (child) pending.push(child);
      }
    }
    const shape = this.version.preview ? unionShapeOf(type, this.core) : null;
    if (!shape?.valid) return super.reportSwitchArms(type, arms, site);
    for (const problem of checkUnionSwitchArms(shape, arms, { ...site, inputType: type, core: this.core, conversions: this.conversions }))
      this.report(problem.node, problem.code, problem.args);
  }
};
