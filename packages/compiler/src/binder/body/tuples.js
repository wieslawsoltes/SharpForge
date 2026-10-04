/**
 * Tuple expressions (SF-A02-T08.4): tuple literals and the element-wise `==` / `!=` of tuples (C# 7.3).
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { tupleElements, tupleLiteralNames, tupleNameProblems, tupleTypeOf } from '../tuples.js';
import { stripNullable } from '../../conversions/nullable.js';

const literalConversionKinds = new Set(['ImplicitTupleLiteral', 'ExplicitTupleLiteral']);

/** The element conversions of a tuple literal conversion, also under the wrapping of a nullable target; else null. */
function elementConversionsOf(conversion) {
  if (literalConversionKinds.has(conversion?.kind)) return conversion.underlying ?? null;
  const inner = conversion?.underlying;
  return inner && !Array.isArray(inner) && literalConversionKinds.has(inner.kind) ? (inner.underlying ?? null) : null;
}

const isTupleType = type => !!type?.isTupleType && !type.isDefinition;
const isTupleOperand = e => e.kind === 'Tuple' || isTupleType(e.type);
const cardinalityOf = e => (e.kind === 'Tuple' ? e.elements.length : tupleElements(e.type).length);

/** Class mixin: tuple literals and tuple equality. */
export const TupleBinding = Base =>
  class extends Base {
    /** `(a, b: c)`: a tuple literal; it has a type when every element has one (`(1, null)` gets its type from the target). */
    tuple(syntax) {
      const elements = syntax.arguments.map(a => this.value(a.expression)),
        { names, inferred } = tupleLiteralNames(syntax.arguments);
      for (const problem of tupleNameProblems(names.map((name, i) => (inferred[i] ? null : name))))
        this.report(syntax.arguments[problem.index].nameColon.name, problem.code, problem.args);
      if (elements.some(e => e.hasErrors)) return this.bad(syntax);
      const typed = elements.every(e => e.type && e.type.specialType !== 'System_Void'),
        types = elements.map(e => e.type);
      const type = typed && elements.length >= 2 ? tupleTypeOf(this.core.bridge, types, names, inferred) : null;
      return this.node('Tuple', syntax, type, { elements, names, form: 'tupleLiteral' });
    }
    /**
     * A tuple literal converted to a tuple type gives its lambda elements their delegate types: in
     * `(Type, Func<int, bool>) pair = (typeof(int), n => n > 0)` the lambda is bound as the second element's type.
     * (The other elements convert where the literal is built; a lambda has no body until it knows its delegate.)
     */
    finishTupleLiteralElements(literal, target, conversion) {
      const parts = elementConversionsOf(conversion);
      if (literal.kind !== 'Tuple' || !parts) return;
      const types = tupleElements(stripNullable(target));
      literal.elements.forEach((element, index) => {
        const type = types[index]?.type;
        if (!type) return;
        if (element.form === 'lambda' && !element.hasErrors) {
          element.boundAs = type;
          this.finishLambda(element, type);
        } else this.finishTupleLiteralElements(element, type, parts[index]);
      });
    }
    /**
     * CS8383: an element name written in a tuple literal is ignored by `==` and `!=` unless the element on the other
     * side has the same name (written, inferred, or from the type of a tuple value).
     */
    reportIgnoredTupleNames(left, right) {
      const namesOf = e => (e.kind === 'Tuple' ? e.names : (e.type?.tupleElementNames ?? [])) ?? [],
        writtenOf = (e, index) => (e.kind === 'Tuple' ? (e.syntax.arguments?.[index] ?? null) : null),
        leftNames = namesOf(left),
        rightNames = namesOf(right);
      for (let index = 0; index < Math.max(leftNames.length, rightNames.length); index++) {
        if ((leftNames[index] ?? null) === (rightNames[index] ?? null)) continue;
        // One warning per element: on the right literal when both sides wrote a name, as Roslyn does.
        const written = [writtenOf(right, index), writtenOf(left, index)].find(argument => argument?.nameColon);
        if (written) this.report(written, DiagnosticId.CS8383, [written.nameColon.name.identifier.valueText]);
      }
    }
    /**
     * `left == right` between tuples: the operator of each pair of elements is resolved on its own (so an element may
     * be `null`, a literal without a type, or a nested tuple), and the results are combined.
     * Returns null when the operands are not both tuples. The bound node keeps the per-element operators in
     * `operation: {elements, leftParts, rightParts}`; a part is the element expression of a literal or a placeholder
     * for the element of a tuple value.
     */
    tupleEquality(syntax, operator, left, right) {
      if ((operator !== '==' && operator !== '!=') || !isTupleOperand(left) || !isTupleOperand(right)) return null;
      const counts = [cardinalityOf(left), cardinalityOf(right)];
      if (counts[0] !== counts[1]) {
        this.report(syntax, DiagnosticId.CS8384, counts);
        return this.bad(syntax, { left, right });
      }
      this.d.gate(this.c.uri, syntax, 'tupleEquality', { name: 'tuple equality', version: 7.3 });
      this.reportIgnoredTupleNames(left, right);
      const partsOf = e =>
        e.kind === 'Tuple'
          ? e.elements
          : tupleElements(e.type).map((argument, index) => this.node('TupleElementPlaceholder', e.syntax, argument.type, { index }));
      const leftParts = partsOf(left),
        rightParts = partsOf(right);
      const elements = leftParts.map((part, index) => {
        const result = this.binaryOperation(syntax, operator, part, rightParts[index]);
        return result.hasErrors || result.type?.specialType === 'System_Boolean' ? result : this.convert(result, this.core.bool, syntax);
      });
      return this.node('Binary', syntax, this.core.bool, {
        operator,
        left,
        right,
        family: 'tuple',
        operation: { elements, leftParts, rightParts },
        hasErrors: elements.some(e => e.hasErrors),
      });
    }
  };
