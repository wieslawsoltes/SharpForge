/**
 * Scopes of expression variables - `out var x`, `e is T x`, deconstruction designations - and discards
 * (SF-A02-T63; C# 7.0, member initializers and queries from C# 7.3).
 *
 * An expression variable belongs to the nearest enclosing scope the language gives it (C# spec 7.7.1):
 *   - in an expression statement, a local declaration, `return`, `throw`, `yield return`, the condition of `if`,
 *     the governing expression of `switch` and the operand of `lock`: the statement list that holds the statement,
 *     so the variable stays visible after the statement and conflicts with other locals of that list;
 *   - in the condition of `while` and `do` and in the collection of `foreach`: that statement only;
 *   - in a `for` header and in `using`: the statement (the binder already opens a scope there);
 *   - in a lambda body, a query clause, an arm of a switch expression, a field initializer or constructor arguments:
 *     that body, clause, arm or initializer.
 * Like any local, the name is reserved in its whole scope: a use before the declaration is CS0841 and a nested
 * declaration of the same name is CS0136. `expressionVariableNames` finds the names a statement adds to its list.
 *
 * `_` is a discard only where no variable named `_` is in scope; a discard is gated as 'discards' below C# 7.
 */

/** Expressions that are a scope of their own: function bodies and the arms of a switch expression. */
const scopeKinds = new Set(['SimpleLambdaExpression', 'ParenthesizedLambdaExpression', 'AnonymousMethodExpression', 'SwitchExpressionArm']);

/** The expressions of a statement whose variables belong to the enclosing statement list. */
function leakingExpressions(statement) {
  switch (statement.kind) {
    case 'ExpressionStatement':
    case 'ReturnStatement':
    case 'ThrowStatement':
    case 'YieldReturnStatement':
    case 'LockStatement':
    case 'SwitchStatement':
      return [statement.expression];
    case 'IfStatement':
      return [statement.condition];
    case 'LocalDeclarationStatement':
      return statement.declaration.variables.map(variable => variable.initializer?.value);
    case 'LabeledStatement':
      return leakingExpressions(statement.statement);
    default:
      return [];
  }
}

/** Adds the names of the variables an expression declares in the scope it is evaluated in. */
function collectDesignations(node, names) {
  if (node.kind === 'SingleVariableDesignation') {
    names.push(node.identifier.valueText);
    return;
  }
  if (scopeKinds.has(node.kind)) return;
  // Only the first `from` of a query is evaluated in the enclosing scope; every other clause is a lambda body.
  if (node.kind === 'QueryExpression') {
    if (node.fromClause) collectDesignations(node.fromClause, names);
    return;
  }
  for (const child of node.childNodes()) collectDesignations(child, names);
}

/** The names of the expression variables a statement declares in the statement list that contains it. */
export function expressionVariableNames(statement) {
  const names = [];
  for (const expression of leakingExpressions(statement)) if (expression) collectDesignations(expression, names);
  return names;
}

/** Statements whose expression variables live in a scope of their own. */
const scopedStatements = new Set(['WhileStatement', 'DoStatement', 'ForEachStatement', 'ForEachVariableStatement']);

/** Class mixin: scopes of expression variables and the discard gate. */
export const ExpressionVariableBinding = Base =>
  class extends Base {
    namesDeclaredIn(statements) {
      const names = super.namesDeclaredIn(statements);
      for (const statement of statements) names.push(...expressionVariableNames(statement));
      return names;
    }
    statement(syntax) {
      if (!scopedStatements.has(syntax.kind)) return super.statement(syntax);
      this.pushScope();
      try {
        return super.statement(syntax);
      } finally {
        this.popScope();
      }
    }
    node(kind, syntax, type, props) {
      // `_ = e` and `M(out _)`: designations (`out var _`, `var (_, x)`) are gated from the syntax tree.
      if (kind === 'Discard' && syntax.kind === 'IdentifierName') this.d.gate(this.c.uri, syntax, 'Discards');
      return super.node(kind, syntax, type, props);
    }
  };
