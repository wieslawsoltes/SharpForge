/**
 * Patterns that look inside a value (SF-A02-T08.1): positional patterns `(p1, p2)` over tuples and `Deconstruct`
 * methods, `var (a, b)`, and list patterns `[p1, .., pn]` with a slice.
 *
 * Bound shapes (added to the pattern node by binder/body/patterns.js):
 *   positional  `{kind: 'tuple'|'method', type, method, isExtension, parts: [{type, pattern, syntax}]}`
 *   ListPattern `{inputType, elementType, patterns, sliceIndex, local}`; a `SlicePattern {pattern}` sits at `sliceIndex`
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { ArrayTypeSymbol, ErrorTypeSymbol } from '../../symbols/types.js';
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
      // `object` is matched through ITuple at run time: that cannot be decided statically.
      if (!isUsable(type) || type.specialType === 'System_Object') {
        if (isUsable(type)) this.incomplete = this.d.incomplete = true;
        bindAll(subpatterns.map(() => unknown));
        return null;
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
    /** `[p1, p2, .., pn]` over an array (any other countable, indexable type is left to the framework epics). */
    listPattern(syntax, inputType) {
      const isArray = inputType instanceof ArrayTypeSymbol && inputType.rank === 1,
        elementType = isArray ? inputType.elementType : unknown;
      if (isUsable(inputType) && !isArray) {
        // A simple type is known to have neither a length nor an indexer; other types may get them from the framework.
        if (numericKind(inputType) || inputType.specialType === 'System_Boolean') {
          this.report(syntax, DiagnosticId.CS8985, [this.display(inputType)]);
          this.report(syntax, DiagnosticId.CS0021, [this.display(inputType)]);
        } else this.incomplete = this.d.incomplete = true;
      }
      let sliceIndex = -1;
      const patterns = syntax.patterns.map((item, index) => {
        if (item.kind !== 'SlicePattern') return this.pattern(item, elementType, null);
        if (sliceIndex >= 0) this.report(item, DiagnosticId.CS8980);
        else sliceIndex = index;
        return { kind: 'SlicePattern', syntax: item, pattern: item.pattern ? this.pattern(item.pattern, isArray ? inputType : unknown, null) : null };
      });
      const bound = { kind: 'ListPattern', syntax, inputType, elementType, patterns, sliceIndex };
      if (syntax.designation) this.designation(syntax.designation, inputType ?? unknown, bound);
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
