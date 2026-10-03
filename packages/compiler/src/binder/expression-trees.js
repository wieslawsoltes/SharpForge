/**
 * What an expression tree may not contain (SF-A02-T07.5). A lambda converted to `Expression<TDelegate>` is data, not
 * code, and only the expression forms System.Linq.Expressions can represent are allowed in it:
 *
 *   CS0834  a statement body                 CS0832  an assignment, compound assignment, ++ or --
 *   CS1989  an async lambda                  CS0831  a base access
 *   CS8072  a null-conditional access        CS8122  an `is` pattern
 *   CS8514  a switch expression              CS8188  a throw expression
 *   CS8074  an index initializer             CS8143  a tuple literal
 *   CS8110  a call of a local function       CS9307  named arguments out of position
 *
 * The checks run when the lambda is bound against its final target, so a lambda converted to a delegate is not
 * touched. Nested lambdas are part of the tree and are checked with it.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { walk } from '../bound/semantic-walker.js';
import { MethodKind } from '../symbols/members.js';
import { expressionTreeDelegate } from '../symbols/expression-tree-types.js';

const assignmentKinds = new Set(['Assignment', 'CompoundAssignment', 'Increment', 'CoalesceAssignment', 'RefAssignment', 'EventAssignment']);
const codeByKind = Object.freeze({
  ConditionalAccess: DiagnosticId.CS8072,
  IsPattern: DiagnosticId.CS8122,
  SwitchExpression: DiagnosticId.CS8514,
  Throw: DiagnosticId.CS8188,
  Tuple: DiagnosticId.CS8143,
  Base: DiagnosticId.CS0831,
});
const isAscending = positions => positions.every((position, index) => index === 0 || position >= positions[index - 1]);

function nodeProblem(node) {
  if (assignmentKinds.has(node.kind)) return DiagnosticId.CS0832;
  if (codeByKind[node.kind]) return codeByKind[node.kind];
  if (node.kind === 'Call') {
    if (node.method?.methodKind === MethodKind.LocalFunction) return DiagnosticId.CS8110;
    if (node.mapping?.parameterOf && !isAscending(node.mapping.parameterOf)) return DiagnosticId.CS9307;
  }
  return null;
}

/** The lambda's own problems: its body form and modifiers. */
function lambdaProblem(lambda) {
  if (lambda.isAsync || lambda.syntax?.asyncKeyword) return DiagnosticId.CS1989;
  return lambda.syntax?.block ? DiagnosticId.CS0834 : null;
}

/**
 * The restrictions a bound lambda violates as an expression tree.
 * @returns {{code: string, syntax: object}[]} in tree order
 */
export function expressionTreeProblems(lambda) {
  const rows = [];
  const check = current => {
    const own = lambdaProblem(current);
    if (own) {
      rows.push({ code: own, syntax: current.syntax });
      return;
    }
    walk(current.body, node => {
      if (node.hasErrors) return false;
      if (node.kind === 'Lambda') {
        check(node);
        return false;
      }
      const code = nodeProblem(node);
      if (code) rows.push({ code, syntax: node.syntax });
      for (const entry of node.initializers ?? [])
        if (entry.target?.isInitializerTarget && entry.target.kind !== 'FieldAccess' && entry.target.kind !== 'PropertyAccess')
          rows.push({ code: DiagnosticId.CS8074, syntax: entry.target.syntax });
      return !code;
    });
  };
  check(lambda);
  return rows;
}

/** Class mixin for the body binder: lambdas whose target is an expression tree. */
export const ExpressionTreeBinding = Base =>
  class extends Base {
    finishLambda(lambda, delegateType) {
      const first = !lambda.finished;
      super.finishLambda(lambda, delegateType);
      if (!first || !lambda.body || !expressionTreeDelegate(delegateType, this.core)) return;
      lambda.isExpressionTree = true;
      for (const problem of expressionTreeProblems(lambda)) this.report(problem.syntax, problem.code, []);
    }
  };
