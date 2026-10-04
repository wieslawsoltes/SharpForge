/**
 * Patterns that look inside a value (SF-A02-T08.1): positional patterns `(p1, p2)` over tuples and `Deconstruct`
 * methods, `var (a, b)`, and list patterns `[p1, .., pn]` with a slice.
 *
 * Bound shapes (added to the pattern node by binder/body/patterns.js):
 *   positional  `{kind: 'tuple'|'method'|'ituple', type, method, isExtension, parts: [{type, pattern, syntax}]}`
 *   ListPattern `{inputType, elementType, patterns, sliceIndex, shape, local}`; a `SlicePattern {pattern}` sits at
 *               `sliceIndex`, and `shape` says how the value is counted, indexed and sliced (list-pattern-shape.js)
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { ErrorTypeSymbol } from '../../symbols/types.js';
import { stripNullable } from '../../conversions/nullable.js';
import { listPatternShapeOf } from '../list-pattern-shape.js';
import { numericKind } from '../../conversions/numeric.js';
import { deconstructionOf } from '../deconstruction.js';
import { typeTestOutcome } from '../../conversions/reference.js';
import { checkSwitchArms } from '../../flow/pattern-exhaustiveness.js';

const unknown = ErrorTypeSymbol.unknown;
const isUsable = type => !!type && !type.isErrorType();

/** Class mixin: positional and list patterns. */
export const StructuralPatternBinding = Base =>
  class extends Base {
    /**
     * The positional clause of a recursive pattern over a value of `type`: how the value splits and the pattern of
     * each part. Returns null when the split cannot be decided here (the subpatterns are still bound).
     */
    positionalClause(clause, type) {
      const subpatterns = clause.subpatterns,
        bindAll = types => subpatterns.map((sub, index) => ({ type: types[index], pattern: this.pattern(sub.pattern, types[index], null), syntax: sub }));
      if (!isUsable(type)) {
        bindAll(subpatterns.map(() => unknown));
        return null;
      }
      // `object` is matched through ITuple at run time: a tuple of that many elements, each tested as an object. The
      // image back ends have no ITuple, so for them the pattern stays outside the profile.
      if (type.specialType === 'System_Object') {
        this.incomplete = this.d.incomplete = true;
        return { kind: 'ituple', type, method: null, isExtension: false, parts: bindAll(subpatterns.map(() => this.core.object)) };
      }
      const split = deconstructionOf(this, type, subpatterns.length, this.node('DeconstructionValue', clause, type, {}));
      if (split.error) {
        if (split.isArity) this.report(clause, DiagnosticId.CS8502, [this.display(type), type.typeArguments.length, subpatterns.length]);
        else for (const problem of split.error) this.report(clause, problem.code, problem.args);
        bindAll(subpatterns.map(() => unknown));
        return null;
      }
      return { kind: split.kind, type, method: split.method ?? null, isExtension: !!split.isExtension, parts: bindAll(split.partTypes) };
    }
    /** `var (a, (b, _))`: a positional pattern whose parts are `var` patterns. */
    varPositionalPattern(designation, type, syntax) {
      const clause = { subpatterns: designation.variables.map(variable => ({ pattern: { kind: 'VarPattern', designation: variable, span: variable.span } })) };
      clause.span = designation.span;
      const positional = this.positionalClause(clause, type);
      return { kind: 'RecursivePattern', syntax, inputType: type, properties: [], positional, hasPositional: true, hasErrors: !positional };
    }
    /** `[p1, p2, .., pn]` over an array, a string or a type with a count and an `int` indexer (list-pattern-shape.js). */
    listPattern(syntax, inputType) {
      // Like a property pattern, a list pattern matches the value of a nullable input.
      const listType = isUsable(inputType) ? stripNullable(inputType) : inputType,
        shape = isUsable(listType) ? listPatternShapeOf(listType, this.core, this.c.containingType) : null,
        elementType = shape?.elementType ?? unknown;
      if (isUsable(listType) && !shape) {
        // A simple type is known to have neither a length nor an indexer; other types may get them from the framework.
        if (numericKind(listType) || listType.specialType === 'System_Boolean') {
          this.report(syntax, DiagnosticId.CS8985, [this.display(listType)]);
          this.report(syntax, DiagnosticId.CS0021, [this.display(listType)]);
        } else this.incomplete = this.d.incomplete = true;
      }
      // The image back ends read list patterns from arrays only: any other shape stays outside their profile.
      if (shape && shape.kind !== 'array') this.incomplete = this.d.incomplete = true;
      let sliceIndex = -1;
      const patterns = syntax.patterns.map((item, index) => {
        if (item.kind !== 'SlicePattern') return this.pattern(item, elementType, null);
        if (sliceIndex >= 0) this.report(item, DiagnosticId.CS8980);
        else sliceIndex = index;
        // A slice with a pattern needs a way to take the slice; `..` alone only skips elements.
        if (item.pattern && shape && !shape.sliceType) this.incomplete = this.d.incomplete = true;
        return { kind: 'SlicePattern', syntax: item, pattern: item.pattern ? this.pattern(item.pattern, shape?.sliceType ?? unknown, null) : null };
      });
      const bound = { kind: 'ListPattern', syntax, inputType: listType, elementType, patterns, sliceIndex, shape };
      if (syntax.designation) this.designation(syntax.designation, listType ?? unknown, bound);
      return bound;
    }
    /**
     * Reports arms that can never be chosen and, for a switch expression, values no arm handles (SF-A02-T08.3).
     * @param {{pattern, when, node, isDefault?}[]} arms  @param {{isExpression, node}} site
     */
    reportSwitchArms(type, arms, site) {
      const constants = new Set();
      const checked = arms.filter(arm => {
        // The same constant twice is the older CS0152, reported where the labels are bound.
        const key = arm.pattern?.kind === 'ConstantPattern' && !arm.when ? arm.pattern.value?.constantValue?.toString() : undefined;
        if (key === undefined) return true;
        if (constants.has(key)) return false;
        constants.add(key);
        return true;
      });
      const isSubtype = (derived, base) => typeTestOutcome(derived, base, this.core) === 'always';
      for (const problem of checkSwitchArms(type, checked, { ...site, isSubtype })) this.report(problem.node, problem.code, problem.args);
    }
    /** A slice outside a list pattern. */
    straySlicePattern(syntax) {
      this.report(syntax, DiagnosticId.CS8980);
      if (syntax.pattern) this.pattern(syntax.pattern, unknown, null);
      return { kind: 'SlicePattern', syntax, pattern: null, hasErrors: true };
    }
  };
