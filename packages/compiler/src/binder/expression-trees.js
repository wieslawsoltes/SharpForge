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
 *   below C# 14 only: CS0854 an invocation that omits optional arguments, CS0853 one that names arguments
 *
 * The checks run when the lambda is bound against its final target, so a lambda converted to a delegate is not
 * touched. Nested lambdas are part of the tree and are checked with it.
 */
import { walk } from '../bound/semantic-walker.js';
import { MethodKind } from '../symbols/members.js';
import { dynamicOperation } from '../bound/dynamic-operations.js';
import { expressionTreeDelegate } from '../symbols/expression-tree-types.js';

const assignmentKinds = new Set(['Assignment', 'CompoundAssignment', 'Increment', 'CoalesceAssignment', 'RefAssignment', 'EventAssignment']);
const codeByKind = Object.freeze({
  ConditionalAccess: 'CS8072',
  IsPattern: 'CS8122',
  SwitchExpression: 'CS8514',
  Throw: 'CS8188',
  Tuple: 'CS8143',
  Base: 'CS0831',
});
const isAscending = positions => positions.every((position, index) => index === 0 || position >= positions[index - 1]);

const invocationKinds = new Set(['Call', 'ObjectCreation', 'IndexerAccess']);
const hasNamedArgument = node => (node.syntax?.argumentList?.arguments ?? []).some(argument => argument.nameColon);

/**
 * Before C# 14 an expression tree may not contain an invocation that omits optional arguments (CS0854) or names
 * arguments (CS0853); C# 14 allows both ("expression trees with optional and named arguments") and keeps CS9307.
 */
function argumentProblem(node, languageVersion) {
  if (languageVersion >= 14 || !invocationKinds.has(node.kind)) return null;
  if (node.mapping?.defaults?.length) return 'CS0854';
  return hasNamedArgument(node) ? 'CS0853' : null;
}

function nodeProblem(node, languageVersion) {
  if (dynamicOperation(node)) return 'CS1963';
  if (assignmentKinds.has(node.kind)) return 'CS0832';
  if (codeByKind[node.kind]) return codeByKind[node.kind];
  if (node.kind === 'Call') {
    if (node.method?.methodKind === MethodKind.LocalFunction) return 'CS8110';
    const before14 = argumentProblem(node, languageVersion);
    if (before14) return before14;
    if (node.mapping?.parameterOf && !isAscending(node.mapping.parameterOf)) return 'CS9307';
  }
  return argumentProblem(node, languageVersion);
}

/** The lambda's own problems: its body form and modifiers. */
function lambdaProblem(lambda) {
  if (lambda.isAsync || lambda.syntax?.asyncKeyword) return 'CS1989';
  return lambda.syntax?.block ? 'CS0834' : null;
}

/**
 * The restrictions a bound lambda violates as an expression tree.
 * @returns {{code: string, syntax: object}[]} in tree order
 */
export function expressionTreeProblems(lambda, { languageVersion = 14 } = {}) {
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
      const code = nodeProblem(node, languageVersion);
      if (code) rows.push({ code, syntax: node.syntax });
      for (const entry of node.initializers ?? [])
        if (entry.target?.isInitializerTarget && entry.target.kind !== 'FieldAccess' && entry.target.kind !== 'PropertyAccess')
          rows.push({ code: 'CS8074', syntax: entry.target.syntax });
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
      for (const problem of expressionTreeProblems(lambda, { languageVersion: this.version.number })) this.report(problem.syntax, problem.code, []);
    }
  };
