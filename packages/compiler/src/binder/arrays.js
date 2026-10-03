import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * Array rules the creation and element-access binders share (SF-A02-T45, C# spec 17.7 and 12.8.17.5).
 *
 *   CS0847  an initializer of a rank-n array is rectangular: every nested initializer of a dimension has the length of
 *           the first one, or the length given as that dimension's size
 *   CS0150  a size written next to an initializer is a constant
 *
 * The other array rules are reported where the construct is bound: CS0846 and CS0623 (nesting of initializers),
 * CS0022 (number of indices), CS0248 (negative size), CS1586 (neither size nor initializer), CS0826 (no best type of
 * an implicitly typed array) and the array conversions (identity of rank, element reference conversions - array
 * covariance - in conversions/reference.js).
 */

/**
 * Checks that the initializer of a rank-`rank` array is rectangular.
 * @param init the ArrayInitializerExpression syntax  @param {number} rank
 * @param {(number|null)[]} lengths the known length per dimension (null: taken from the first initializer seen)
 * @returns {{node: object, code: string, args: any[]}[]}
 */
export function initializerShapeProblems(init, rank, lengths = []) {
  const expected = Array.from({ length: rank }, (_, dimension) => lengths[dimension] ?? null),
    problems = [];
  const visit = (node, dimension) => {
    const count = node.expressions.length;
    if (expected[dimension] === null) expected[dimension] = count;
    else if (expected[dimension] !== count) problems.push({ node, code: DiagnosticId.CS0847, args: [expected[dimension]] });
    if (dimension + 1 >= rank) return;
    for (const nested of node.expressions) if (nested.kind === 'ArrayInitializerExpression') visit(nested, dimension + 1);
  };
  visit(init, 0);
  return problems;
}

/** Class mixin of the body binder: the array rules above. */
export const ArrayBinding = Base =>
  class extends Base {
    /**
     * Reports the shape problems of an array initializer.
     * @param {object[]} [sizes] the bound size expressions written before the initializer, one per dimension
     */
    checkArrayInitializer(init, rank, sizes = []) {
      const lengths = sizes.map(size => {
        if (size.hasErrors) return null;
        const constant = size.constantValue;
        if (constant?.isIntegral) return Number(constant.bigint);
        this.report(size.syntax, DiagnosticId.CS0150);
        return null;
      });
      for (const problem of initializerShapeProblems(init, rank, lengths)) this.report(problem.node, problem.code, problem.args);
    }
    /** `new[,] { { a, b }, { c, d } }`: the element type is the best common type of the innermost expressions. */
    implicitMultiDimensionalArray(syntax) {
      const rank = syntax.commas.length + 1,
        leaves = [];
      let malformed = false;
      const collect = (init, depth) =>
        init.expressions.map(expression => {
          const isNested = expression.kind === 'ArrayInitializerExpression';
          if (isNested === depth + 1 < rank) {
            if (isNested) return collect(expression, depth + 1);
            leaves.push(this.value(expression));
            return leaves.at(-1);
          }
          this.report(expression, isNested ? DiagnosticId.CS0623 : DiagnosticId.CS0846);
          malformed = true;
          return null;
        });
      const tree = collect(syntax.initializer, 0);
      this.checkArrayInitializer(syntax.initializer, rank);
      if (malformed || leaves.some(leaf => leaf.hasErrors)) return this.bad(syntax);
      const elementType = this.bestCommonType(leaves);
      if (!elementType) {
        this.report(syntax, DiagnosticId.CS0826);
        return this.bad(syntax);
      }
      const convert = level => level.map(entry => (Array.isArray(entry) ? convert(entry) : this.implicitArrayElement(entry, elementType)));
      return this.node('ArrayCreation', syntax, this.core.arrayOf(elementType, rank), { elements: convert(tree) });
    }
  };
