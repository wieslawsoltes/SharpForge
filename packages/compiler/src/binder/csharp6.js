/**
 * C# 6 binding rules that are decided without the binder's state (SF-A02-T61): what the argument of `nameof` may
 * be, which members `using static` brings into scope for a simple name, and the warnings for an exception filter
 * that is a constant. Each function answers with data; the body binder reports and builds the bound nodes.
 */
import { SymbolKind } from '../symbols/types.js';
import { ConstantValue } from '../constants/constant-value.js';

const nameKinds = new Set(['IdentifierName', 'GenericName']);
const missingMemberCodes = new Set(['CS0117', 'CS1061']);
/** What may stand to the left of a `.` inside a `nameof` argument, besides a name or another member access. */
const qualifierKinds = new Set(['PredefinedType', 'ThisExpression', 'BaseExpression', 'AliasQualifiedName']);

/**
 * Checks the shape of a `nameof` argument: a simple name or a member access whose qualifiers are names.
 * Roslyn applies this after the argument bound without errors.
 * @param expression the argument's expression syntax
 * @returns {null|{code:string,node:object}} CS8081 (no name), CS8082 (a sub-expression that is not a name) or
 *   CS8083 (an alias-qualified name), with the syntax to report it on
 */
export function nameofArgumentProblem(expression) {
  if (nameKinds.has(expression.kind)) return null;
  if (expression.kind === 'AliasQualifiedName') return { code: 'CS8083', node: expression };
  if (expression.kind !== 'SimpleMemberAccessExpression') return { code: 'CS8081', node: expression };
  for (let left = expression.expression; ; left = left.expression) {
    if (nameKinds.has(left.kind) || qualifierKinds.has(left.kind)) return null;
    if (left.kind !== 'SimpleMemberAccessExpression') return { code: 'CS8082', node: left };
  }
}

/** The name a valid `nameof` argument denotes: its last identifier. */
export function nameofValue(expression) {
  const last = expression.kind === 'SimpleMemberAccessExpression' ? expression.name : expression;
  return last.identifier?.valueText ?? last.toString();
}

/**
 * The static members named `name` that `using static` directives of one scope level import for a simple name.
 * Extension methods are not imported this way (they are found only as instance calls), and neither are instance
 * members. Methods of several types form one group; a field, property or event found in two types is ambiguous.
 * @param {object[]} staticTypes the types of the `using static` directives  @param {string} name
 * @returns {{members:object[], ambiguous:null|object[]}} `ambiguous` holds the two members CS0229 names
 */
export function staticImportsNamed(staticTypes, name) {
  const found = staticTypes.flatMap(type => type.getMembers(name).filter(member => member.isStatic && !member.isExtensionMethod));
  if (!found.length) return { members: [], ambiguous: null };
  const members = found.filter(member => member.kind === found[0].kind);
  const isGroup = found[0].kind === SymbolKind.Method;
  if (!isGroup && found.length > 1) return { members, ambiguous: [found[0], found[1]] };
  return { members, ambiguous: null };
}

/**
 * The warning for an exception filter whose condition is a constant, or null.
 * @param {boolean} value the constant value of the filter
 * @param {boolean} isOnlyHandler true when the try statement has no other catch clause and no finally block
 * @returns {string} CS7095 (always true), CS8360 (always false, the whole try-catch is redundant) or CS8359
 */
export function constantFilterWarning(value, isOnlyHandler) {
  if (value) return 'CS7095';
  return isOnlyHandler ? 'CS8360' : 'CS8359';
}

/** Class mixin for the body binder: the `nameof` operator, null-conditional statements and constant exception filters. */
export const CSharp6Binding = Base =>
  class extends Base {
    invocation(syntax) {
      const callee = syntax.expression;
      // `nameof` is an operator only when no method, local or type of that name is in scope.
      const isOperator =
        callee.kind === 'IdentifierName' &&
        callee.identifier.valueText === 'nameof' &&
        this.expression(callee, { invoked: true }).kind === 'NameOfMarker';
      return isOperator ? this.nameofExpression(syntax) : super.invocation(syntax);
    }
    /** `nameof(x)`: a string constant; the argument is bound for its errors and uses but never evaluated. */
    nameofExpression(syntax) {
      const args = syntax.argumentList.arguments;
      if (args.length !== 1) {
        // With any other number of arguments this is a call to a method named nameof, and there is none.
        this.report(syntax.expression, 'CS0103', ['nameof']);
        return this.bad(syntax, { args: this.arguments(syntax.argumentList) });
      }
      this.d.gate(this.c.uri, syntax, 'Nameof');
      const argument = args[0].expression,
        { operand, errors } = this.nameofOperand(argument),
        node = this.node('NameOf', syntax, this.core.string);
      // The result is a string whatever the argument is. It stays a constant when the argument at least names
      // something: Roslyn keeps the name after "no such member", and after the shape errors below.
      if (errors.length && !errors.every(row => missingMemberCodes.has(row.code))) return node;
      const problem = errors.length ? null : nameofArgumentProblem(argument);
      if (problem) this.report(problem.node, problem.code);
      else if (operand.kind === 'MethodGroup' && operand.typeArguments) this.report(argument, 'CS8084');
      if (operand.kind === 'Local') operand.local.reads++;
      node.constantValue = ConstantValue.string(nameofValue(argument));
      return node;
    }
    /**
     * Binds the argument of `nameof`. Its diagnostics are reported only when it has errors; an argument the closed
     * framework registry cannot resolve has none.
     * @returns {{operand: object, errors: object[]}} the bound argument and the error rows that were reported
     */
    nameofOperand(argument) {
      const saved = this.quiet,
        collected = [];
      this.quiet = collected;
      let operand;
      try {
        operand = this.expression(argument, { nameofOperand: true });
      } finally {
        this.quiet = saved;
      }
      if (!operand.hasErrors) return { operand, errors: [] };
      for (const row of collected) this.report(row.node, row.code, row.args);
      return { operand, errors: collected.filter(row => this.d.isError(row.code)) };
    }
    /** `a?.M();` is a statement; `a?.Name;` is not (CS0201): what follows the last `?.` decides. */
    isStatementExpression(syntax) {
      if (syntax.kind === 'ConditionalAccessExpression') return this.isStatementExpression(syntax.whenNotNull);
      return super.isStatementExpression(syntax);
    }
    catchClause(clause, order) {
      const bound = super.catchClause(clause, order),
        constant = bound.filter?.constantValue;
      if (constant && typeof constant.value === 'boolean') {
        const statement = clause.parent,
          isOnlyHandler = statement.catches.length === 1 && !statement.finally;
        this.report(clause.filter.filterExpression, constantFilterWarning(constant.value, isOnlyHandler));
      }
      return bound;
    }
  };
