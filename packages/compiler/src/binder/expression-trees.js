/**
 * What an expression tree may not contain (SF-A02-T07.5). A lambda converted to `Expression<TDelegate>` is data, not
 * code, and only the expression forms System.Linq.Expressions can represent are allowed in it:
 *
 *   CS0834  a statement body                 CS0832  an assignment, compound assignment, ++ or --
 *   CS1989  an async lambda                  CS0831  a base access
 *   CS8072  a null-conditional access        CS8122  an `is` pattern
 *   CS8514  a switch expression              CS8188  a throw expression
 *   CS8074  an index initializer             CS8143  a tuple literal
 *   CS0838  a rectangular array initializer
 *   CS1951  a ref/out/in lambda parameter    CS8153  a ref-returning call or property
 *   CS8972  lambda or parameter attributes
 *   CS8110  a call of a local function       CS9307  named arguments out of position
 *   below C# 14 only: CS0854 an invocation that omits optional arguments, CS0853 one that names arguments
 *
 * The checks run when the lambda is bound against its final target, so a lambda converted to a delegate is not
 * touched. Nested lambdas are part of the tree and are checked with it.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { previewStampText } from '@sharpforge/syntax';
import { walk } from '../bound/semantic-walker.js';
import { MethodKind } from '../symbols/members.js';
import { RefKind } from '../symbols/types.js';
import { dynamicOperation } from '../bound/dynamic-operations.js';
import { expressionTreeDelegate } from '../symbols/expression-tree-types.js';

const assignmentKinds = new Set(['Assignment', 'CompoundAssignment', 'Increment', 'CoalesceAssignment', 'RefAssignment', 'EventAssignment']);
const codeByKind = Object.freeze({
  ConditionalAccess: DiagnosticId.CS8072,
  IsPattern: DiagnosticId.CS8122,
  SwitchExpression: DiagnosticId.CS8514,
  Throw: DiagnosticId.CS8188,
  Tuple: DiagnosticId.CS8143,
  Base: DiagnosticId.CS0831,
  InlineArrayAccess: DiagnosticId.CS9170,
  InlineArraySlice: DiagnosticId.CS9170,
  InlineArrayConversion: DiagnosticId.CS9170,
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
  if (node.mapping?.defaults?.length) return DiagnosticId.CS0854;
  return hasNamedArgument(node) ? DiagnosticId.CS0853 : null;
}

function nodeProblem(node, languageVersion) {
  if (dynamicOperation(node)) return DiagnosticId.CS1963;
  if (assignmentKinds.has(node.kind)) return DiagnosticId.CS0832;
  if (codeByKind[node.kind]) return codeByKind[node.kind];
  // The pinned preview proposal has no tree conversion rule; Roslyn 8d2c75f2 also rejects ConversionKind.Union.
  if (node.kind === 'Conversion' && node.conversion?.kind === 'ImplicitUnion') return DiagnosticId.SF2202;
  if (node.kind === 'ArrayCreation' && node.type?.rank > 1 && node.syntax?.initializer) return DiagnosticId.CS0838;
  if (node.kind === 'Conversion' && node.conversion?.kind === 'MethodGroup' &&
      node.conversion.method?.methodKind === MethodKind.LocalFunction) return DiagnosticId.CS8110;
  if (['PropertyAccess', 'IndexerAccess'].includes(node.kind) && node.property?.refKind && node.property.refKind !== RefKind.None)
    return DiagnosticId.CS8153;
  if (node.kind === 'Call') {
    if (node.method?.methodKind === MethodKind.LocalFunction) return DiagnosticId.CS8110;
    // A call that is removed: a partial method without an implementing part, or an omitted [Conditional] method.
    if ((node.method?.originalDefinition ?? node.method)?.isUnimplementedPartial || node.isOmitted) return DiagnosticId.CS0765;
    const before14 = argumentProblem(node, languageVersion);
    if (before14) return before14;
    if (node.mapping?.parameterOf && !isAscending(node.mapping.parameterOf)) return DiagnosticId.CS9307;
    if (node.method?.refKind && node.method.refKind !== RefKind.None) return DiagnosticId.CS8153;
  }
  return argumentProblem(node, languageVersion);
}

/** The lambda's own problems: its body form and modifiers. */
function lambdaProblem(lambda) {
  if (lambda.isAsync || lambda.syntax?.asyncKeyword) return DiagnosticId.CS1989;
  if (lambda.syntax?.block) return DiagnosticId.CS0834;
  return lambda.syntax?.expressionBody?.kind === 'RefExpression' ? DiagnosticId.CS8155 : null;
}

/** Attributes are checked after binding, so ignored targets and unresolved attribute types do not add CS8972. */
function declarationProblems(lambda) {
  const problems = [],
    attributed = (symbol, locations) => (symbol?.boundAttributes ?? []).some(attribute => locations.includes(attribute.location));
  let reportedAttributes = attributed(lambda.symbol, ['method', 'return']);
  if (reportedAttributes) problems.push({ code: DiagnosticId.CS8972, syntax: lambda.syntax });
  const attributeParameters = lambda.symbol?.parameters ?? lambda.parameters ?? [];
  for (const [index, parameter] of (lambda.parameters ?? []).entries()) {
    const syntax = parameter.syntax?.identifier ?? lambda.parameterSyntax?.[index]?.identifier ?? lambda.syntax;
    if (parameter.refKind !== RefKind.None) problems.push({ code: DiagnosticId.CS1951, syntax });
    if (!reportedAttributes && attributed(attributeParameters[index], ['param'])) {
      problems.push({ code: DiagnosticId.CS8972, syntax });
      reportedAttributes = true;
    }
  }
  return problems;
}

/**
 * The restrictions a bound lambda violates as an expression tree.
 * @returns {{code: string, syntax: object}[]} in tree order
 */
export function expressionTreeProblems(lambda, { languageVersion = 14 } = {}) {
  const rows = [];
  const check = current => {
    rows.push(...declarationProblems(current));
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
      if (code) rows.push({
        code,
        syntax: node.kind === 'Conversion' && code === DiagnosticId.CS8110 ? node.operand.syntax : node.syntax,
        ...(code === DiagnosticId.SF2202 ? { args: ['implicit union conversions in expression trees', previewStampText('Unions')] } : {}),
      });
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
      for (const problem of expressionTreeProblems(lambda, { languageVersion: this.version.number }))
        this.report(problem.syntax, problem.code, problem.args ?? []);
    }
  };
