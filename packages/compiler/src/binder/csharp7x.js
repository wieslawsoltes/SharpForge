/**
 * C# 7.1 - 7.3 binding rules (SF-A02-T65).
 *
 * The `default` literal (7.1) has no type of its own: it takes the type it is converted to, and where the language
 * supplies no target it is an error -
 *   CS8716  no target type: `default.M()`, `-default`, `foreach (var x in default)`, `lock (default)`, `default as T`,
 *           `default is T`
 *   CS8315  `default == default`: both operands need the other's type
 *   CS8310  a binary operator other than `==` / `!=` applied to `default`
 *   CS8505  `default` as a pattern (`e is default`, `case default:`)
 * Converted to a type with a constant default it is a constant (`const int k = default;`).
 *
 * Non-trailing named arguments (7.2): below C# 7.2 a positional argument after a named one is CS1738, reported on
 * that positional argument.
 *
 * `in` arguments (7.2) must be variables (CS8156). A constructed struct - `Pair<int>` - satisfies the `unmanaged`
 * constraint from C# 8 only: below it the call is gated as 'unmanaged constructed types'.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { ConversionKind } from '../conversions/classify.js';
import { defaultConstant } from '../constants/default-constant.js';
import { isNullableType } from '../conversions/nullable.js';
import { RefKind } from '../symbols/types.js';
import { classifyVariable } from './ref-kinds.js';
import { isUnmanagedType } from './constraints.js';

const unparenthesized = syntax => {
  while (syntax?.kind === 'ParenthesizedExpression') syntax = syntax.expression;
  return syntax;
};
const isDefaultLiteral = syntax => unparenthesized(syntax)?.kind === 'DefaultLiteralExpression';

/** The parent of a default literal (parentheses skipped) and the literal's outermost syntax under it. */
function contextOf(syntax) {
  let node = syntax;
  while (node.parent?.kind === 'ParenthesizedExpression') node = node.parent;
  return { parent: node.parent, node };
}

/** True when a default literal stands where an expression must have a type of its own. */
function needsNaturalType(syntax) {
  const { parent, node } = contextOf(syntax);
  switch (parent?.kind) {
    case 'SimpleMemberAccessExpression':
    case 'ConditionalAccessExpression':
    case 'ElementAccessExpression':
    case 'InvocationExpression':
    case 'ForEachStatement':
    case 'LockStatement':
    case 'AwaitExpression':
      return parent.expression === node;
    case 'AsExpression':
    case 'IsExpression':
      return parent.left === node;
    case 'IsPatternExpression':
      return parent.expression === node;
    case 'UnaryPlusExpression':
    case 'UnaryMinusExpression':
    case 'BitwiseNotExpression':
    case 'LogicalNotExpression':
      return parent.operand === node;
    default:
      return false;
  }
}

const equalityOperators = new Set(['==', '!=']);

/** Class mixin: the default literal and the named-argument version gate. */
export const CSharp7xBinding = Base =>
  class extends Base {
    expression(syntax, options = {}) {
      if (syntax.kind === 'DefaultLiteralExpression' && needsNaturalType(syntax)) {
        this.report(syntax, DiagnosticId.CS8716);
        return this.bad(syntax);
      }
      return super.expression(syntax, options);
    }
    binary(syntax, operator) {
      const left = isDefaultLiteral(syntax.left),
        right = isDefaultLiteral(syntax.right);
      if (!left && !right) return super.binary(syntax, operator);
      if (equalityOperators.has(operator)) {
        if (!(left && right)) return super.binary(syntax, operator);
        this.report(syntax, DiagnosticId.CS8315, [operator, 'default', 'default']);
        return this.bad(syntax);
      }
      // The other operand is still bound for its own diagnostics.
      if (!left) this.value(syntax.left);
      if (!right) this.value(syntax.right);
      this.report(syntax, DiagnosticId.CS8310, [operator, 'default']);
      return this.bad(syntax);
    }
    pattern(syntax, inputType, input) {
      if (syntax.kind === 'ConstantPattern' && isDefaultLiteral(syntax.expression)) {
        this.report(unparenthesized(syntax.expression), DiagnosticId.CS8505);
        return { kind: 'Bad', syntax, hasErrors: true };
      }
      return super.pattern(syntax, inputType, input);
    }
    applyConversion(e, type, conversion, node = e.syntax, isExplicit = false) {
      const result = super.applyConversion(e, type, conversion, node, isExplicit);
      if (conversion.kind === ConversionKind.DefaultLiteral && !result.constantValue) result.constantValue = defaultConstant(type);
      return result;
    }
    finishCall(result, receiver, args, syntax, options = {}) {
      for (const argument of args) this.checkInArgument(argument);
      const group = options.group ?? null;
      this.checkUnmanagedConstructedTypes(result.method, group?.nameNode ?? group?.syntax ?? syntax);
      return super.finishCall(result, receiver, args, syntax, options);
    }
    /** An argument passed with `in` must be a variable: the callee gets a reference to it (CS8156). */
    checkInArgument(argument) {
      if (argument.refKind !== RefKind.In || argument.hasErrors) return;
      if (!classifyVariable(argument, this.variableContext).isVariable) this.report(argument.syntax, DiagnosticId.CS8156);
    }
    /** A generic struct counts as unmanaged from C# 8 ('unmanaged constructed types'); the use is reported on the method name. */
    checkUnmanagedConstructedTypes(method, nameNode) {
      const parameters = method.typeParameters ?? [],
        typeArguments = method.typeArguments ?? [];
      parameters.forEach((parameter, i) => {
        const argument = typeArguments[i]?.type ?? typeArguments[i];
        if (!parameter.hasUnmanagedTypeConstraint || !argument?.typeArguments?.length || argument.isValueType !== true) return;
        if (isNullableType(argument) || !isUnmanagedType(argument)) return;
        this.d.gate(this.c.uri, nameNode, 'UnmanagedConstructedTypes');
      });
    }
    arguments(list) {
      if (list && this.version.number < 7.2) this.checkNamedArgumentOrder(list.arguments);
      return super.arguments(list);
    }
    /** CS1738 on the first positional argument that follows a named one (C# 7.1 and below). */
    checkNamedArgumentOrder(args) {
      let named = false;
      for (const argument of args) {
        if (argument.nameColon) named = true;
        else if (named) {
          this.report(argument, DiagnosticId.CS1738, ['7.2']);
          return;
        }
      }
    }
  };
