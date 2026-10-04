/**
 * Lambdas converted to `Expression<TDelegate>` (SF-A02-T30): the lambda is not compiled to a method; the code
 * builds the tree that describes it, by the factory calls of `System.Linq.Expressions.Expression`
 * (expression-tree-factories.js) over the tree the lowering describes (lowering/expression-trees.js).
 *
 * What an expression tree cannot hold is a compile-time error the binder reports; a construct the lowering has no
 * factory call for is SF2200.
 */
import { lowerExpressionTree } from '../../lowering/expression-trees.js';
import { expressionTreeDelegate } from '../../symbols/expression-tree-types.js';
import { ExpressionTreeFactories } from './expression-tree-factories.js';

/** Class mixin: expression trees. */
export const ExpressionTreeEmission = Base =>
  class extends Base {
    /** The array type over an element type, for the signatures of factory methods. */
    arrayTypeOf(elementType) {
      return this.core.arrayOf(elementType);
    }
    /** Pushes the `Expression<TDelegate>` of a lambda; `treeType` is that type. */
    expressionTree(lambda, treeType) {
      const delegateType = expressionTreeDelegate(treeType, this.core),
        lowered = lowerExpressionTree(lambda, delegateType, this.core);
      if (lowered.unsupported) return this.unsupported(`${lowered.unsupported} in an expression tree`, lowered.syntax ?? lambda.syntax);
      return new ExpressionTreeFactories(this).emit(lowered.tree);
    }
    anonymousFunctionConversion(node) {
      if (!expressionTreeDelegate(node.type, this.core)) return super.anonymousFunctionConversion(node);
      return this.expressionTree(node.operand, node.type);
    }
    exprLambda(node) {
      if (!expressionTreeDelegate(node.boundAs, this.core)) return super.exprLambda(node);
      return this.expressionTree(node, node.boundAs);
    }
  };
