import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * C# 7.0 rules of throw expressions and generalized async return types (SF-A02-T64).
 *
 * A throw expression has no type and is allowed only where control can leave an expression: as the second or
 * third operand of `?:`, as the right operand of `??`, and as the body of an expression-bodied member or lambda.
 * Anywhere else it is CS8115 on the `throw` keyword, and what contains it is not checked further. As an expression
 * body it stands for a statement, so a void member or an `Action` lambda may be `=> throw e`.
 *
 * An async method may return any task-like type: `Task`, `Task<T>`, `ValueTask`, `ValueTask<T>` or a type that names
 * its builder with `[AsyncMethodBuilder(typeof(Builder))]`. `asyncResultType` gives the type its `return`
 * statements produce.
 */

const lambdaKinds = new Set(['SimpleLambdaExpression', 'ParenthesizedLambdaExpression']);

/** True when a ThrowExpression stands where the language allows one. */
export function isThrowExpressionAllowed(syntax) {
  const parent = syntax.parent;
  switch (parent?.kind) {
    case 'ConditionalExpression':
      return parent.whenTrue === syntax || parent.whenFalse === syntax;
    case 'CoalesceExpression':
      return parent.right === syntax;
    case 'ArrowExpressionClause':
      return true;
    default:
      return lambdaKinds.has(parent?.kind) && parent.expressionBody === syntax;
  }
}

const builderAttributeNames = new Set(['AsyncMethodBuilder', 'AsyncMethodBuilderAttribute']);

/** True when a type declaration carries `[AsyncMethodBuilder(...)]` (recognised by name: attributes are not bound to symbols yet). */
function namesAsyncMethodBuilder(type) {
  const definition = type.originalDefinition ?? type;
  for (const declaration of definition.declarations ?? []) {
    for (const list of declaration.syntax?.attributeLists ?? []) {
      for (const attribute of list.attributes ?? []) {
        const name = attribute.name?.kind === 'QualifiedName' ? attribute.name.right : attribute.name;
        if (builderAttributeNames.has(name?.identifier?.valueText)) return true;
      }
    }
  }
  return false;
}

/**
 * The type the `return` statements of an async function with the declared return type produce.
 * @returns {object|null} a type (`void` for a non-generic task-like), or null when `declared` is not task-like
 */
export function asyncResultType(declared, core) {
  if (!declared) return null;
  const isValueTask = declared.name === 'ValueTask';
  if (declared.originalDefinition === core.taskT || (isValueTask && declared.typeArguments?.length === 1)) return declared.typeArguments[0].type;
  if (declared.equals(core.task) || isValueTask) return core.void;
  if (!namesAsyncMethodBuilder(declared)) return null;
  const typeArguments = declared.typeArguments ?? [];
  if (typeArguments.length > 1) return null;
  return typeArguments.length ? typeArguments[0].type : core.void;
}

/** Class mixin: throw expressions. */
export const CSharp70Binding = Base =>
  class extends Base {
    expression(syntax, options = {}) {
      if (syntax.kind !== 'ThrowExpression' || isThrowExpressionAllowed(syntax)) return super.expression(syntax, options);
      // The operand is still bound for its own diagnostics.
      this.value(syntax.expression);
      // Where the parser already rejected the `throw` (an operand of a binary operator is CS1525) nothing is added.
      if (!this.hasSyntaxErrorAt(syntax.throwKeyword.span.start)) this.report(syntax.throwKeyword, DiagnosticId.CS8115);
      return this.bad(syntax);
    }
    /** True when the parser reported an error that starts at `position` of this binder's file. */
    hasSyntaxErrorAt(position) {
      const file = this.d.files?.find(candidate => candidate.source.uri === this.c.uri);
      return !!file?.diagnostics.some(diagnostic => diagnostic.start === position && diagnostic.code !== DiagnosticId.CS8115);
    }
    /** An expression body `=> throw e` is a statement, also where no value is expected. */
    isStatementExpression(syntax) {
      return syntax.kind === 'ThrowExpression' || super.isStatementExpression(syntax);
    }
  };
