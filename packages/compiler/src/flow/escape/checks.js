/**
 * The escape checks of ref safety: each takes bound expressions and returns the problems Roslyn reports, as
 * `{ node, code, args }` (node is the syntax the diagnostic sits on), innermost cause first.
 *   CS8352  a variable whose value may not leave its scope       CS8353  a stackalloc result that would escape
 *   CS8347  a call result that may expose one of its arguments   CS8350  arguments of different scopes mixed
 *   CS8351  ref conditional branches of different scopes         CS8374 / CS9079  ref assignment to a wider variable
 *   CS8166-CS8170, CS8157, CS8158, CS9075-CS9078  a reference that may not be returned
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { RefKind } from '../../symbols/types.js';
import { isRefLike } from '../../binder/ref-struct.js';
import { EscapeScope, variableOf } from './contexts.js';
import { isRefField, isScopedParameter, isUnscopedRef, invokedSymbol, isByReference } from './symbols.js';

const invocationKinds = new Set(['Call', 'ObjectCreation', 'PropertyAccess', 'IndexerAccess']);
const valueKinds = new Set(['Literal', 'Default', 'Binary', 'Unary', 'Conversion', 'ObjectCreation', 'ArrayCreation', 'Conditional']);
const isReturnable = scope => scope <= EscapeScope.ReturnOnly;
const problem = (node, code, args = []) => ({ node, code, args });

/** The diagnostic for a parameter whose reference cannot escape to `escapeTo`. */
function parameterRefProblem(parameter, refSafe, checkingReceiver) {
  // An `out` parameter is implicitly scoped under the C# 11 rules.
  const scoped = isScopedParameter(parameter) || (parameter.refKind === RefKind.Out && !isUnscopedRef(parameter));
  const byReference = isByReference(parameter.refKind);
  if (byReference && scoped) return checkingReceiver ? DiagnosticId.CS9076 : DiagnosticId.CS9075;
  if (byReference && refSafe === EscapeScope.ReturnOnly) return checkingReceiver ? DiagnosticId.CS9078 : DiagnosticId.CS9077;
  return checkingReceiver ? DiagnosticId.CS8167 : DiagnosticId.CS8166;
}

/** Class mixin over EscapeContexts. */
export const EscapeChecks = Base =>
  class extends Base {
    /** Problems of letting the value of `expression` escape to `escapeTo`; `node` is where a variable is blamed. */
    valueEscapeProblems(expression, escapeTo, node = expression?.syntax) {
      const e = expression;
      if (!e || !e.type || !isRefLike(e.type) || this.safeContext(e) <= escapeTo) return [];
      switch (e.kind) {
        case 'Local':
          return [problem(node, DiagnosticId.CS8352, [e.local.name])];
        case 'Parameter':
          return [problem(node, DiagnosticId.CS8352, [e.parameter.name])];
        case 'This':
          return [problem(node, DiagnosticId.CS8352, ['this'])];
        case 'StackAlloc':
          return [problem(e.syntax, DiagnosticId.CS8353, [e.type.toDisplayString()])];
        case 'Ref':
        case 'Conversion':
          return this.valueEscapeProblems(e.operand, escapeTo, e.operand?.kind === 'StackAlloc' ? e.operand.syntax : node);
        case 'FieldAccess':
          return this.valueEscapeProblems(e.receiver, escapeTo, node);
        case 'Conditional':
        case 'RefConditional':
          return [...this.valueEscapeProblems(e.whenTrue, escapeTo), ...this.valueEscapeProblems(e.whenFalse, escapeTo)];
        case 'Coalesce':
          return [...this.valueEscapeProblems(e.left, escapeTo), ...this.valueEscapeProblems(e.right, escapeTo)];
        default:
          return invocationKinds.has(e.kind) ? this.invocationEscapeProblems(e, escapeTo, node) : [];
      }
    }
    /** Problems of letting a reference to the variable `expression` escape to `escapeTo`. */
    refEscapeProblems(expression, escapeTo, node = variableOf(expression)?.syntax, checkingReceiver = false) {
      const e = variableOf(expression);
      if (!e || e.hasErrors) return [];
      const refSafe = this.refSafeContext(e);
      if (refSafe <= escapeTo) return [];
      switch (e.kind) {
        case 'Local': {
          if (!isReturnable(escapeTo)) return [problem(node, DiagnosticId.CS8352, [e.local.name])];
          const isRefLocal = isByReference(e.local.refKind);
          if (checkingReceiver) return [problem(e.syntax, isRefLocal ? DiagnosticId.CS8158 : DiagnosticId.CS8169, [e.local.name])];
          return [problem(node, isRefLocal ? DiagnosticId.CS8157 : DiagnosticId.CS8168, [e.local.name])];
        }
        case 'Parameter': {
          const code = parameterRefProblem(e.parameter, refSafe, checkingReceiver);
          return [problem(checkingReceiver ? e.syntax : node, code, [e.parameter.name])];
        }
        case 'This':
          return [problem(node, DiagnosticId.CS8170)];
        case 'FieldAccess':
          return isRefField(e.field)
            ? this.valueEscapeProblems(e.receiver, escapeTo, node)
            : this.refEscapeProblems(e.receiver, escapeTo, node, true);
        case 'RefConditional':
          return [...this.refEscapeProblems(e.whenTrue, escapeTo), ...this.refEscapeProblems(e.whenFalse, escapeTo)];
        case 'Call':
        case 'PropertyAccess':
        case 'IndexerAccess':
          if (isByReference(e.method?.refKind ?? e.property?.refKind)) return this.invocationEscapeProblems(e, escapeTo, node);
          return isReturnable(escapeTo) ? [problem(node, DiagnosticId.CS8156)] : [];
        default:
          // A value passed to an `in` parameter lives in a temporary of the current method.
          return valueKinds.has(e.kind) && isReturnable(escapeTo) ? [problem(node, DiagnosticId.CS8156)] : [];
      }
    }
    /** CS8347: the first argument that cannot escape as far as the result is used, with its own problem first. */
    invocationEscapeProblems(invocation, escapeTo, node = invocation.syntax) {
      for (const value of this.escapeValues(invocation)) {
        if (value.isOut) continue;
        const inner = value.isRef
          ? this.refEscapeProblems(value.argument, escapeTo)
          : this.valueEscapeProblems(value.argument, escapeTo);
        if (!inner.length) continue;
        // A receiver that cannot escape is blamed on its own; an argument also names the call and the parameter.
        if (!value.parameter) return inner;
        return [...inner, problem(node, DiagnosticId.CS8347, [invokedSymbol(invocation)?.toDisplayString?.() ?? '', value.parameter.name])];
      }
      return [];
    }
    /**
     * Method arguments must match (CS8350): a ref struct passed by writable reference could be assigned any other
     * argument by the callee, so no other argument may be narrower than it.
     */
    argumentMixingProblems(invocation) {
      const values = this.escapeValues(invocation);
      for (const target of values) {
        if (!target.mixable || !isAssignableTarget(target.argument)) continue;
        const targetScope = this.safeContext(variableOf(target.argument));
        // What a parameter may be assigned: an `out` ref struct takes return-only values, a `ref` one only caller-wide ones.
        const targetLevel = target.isOut ? EscapeScope.ReturnOnly : EscapeScope.CallingMethod;
        for (const source of values) {
          if (source === target || source.isOut || source.argument === target.argument) continue;
          const sourceLevel = source.isRef && !(source.parameter && isUnscopedRef(source.parameter)) ? EscapeScope.ReturnOnly : EscapeScope.CallingMethod;
          if (sourceLevel > targetLevel) continue;
          const inner = source.isRef
            ? this.refEscapeProblems(source.argument, targetScope)
            : this.valueEscapeProblems(source.argument, targetScope);
          if (inner.length) {
            const symbol = invokedSymbol(invocation);
            return [...inner, problem(invocation.syntax, DiagnosticId.CS8350, [symbol?.toDisplayString?.() ?? '', source.parameter?.name ?? 'this'])];
          }
        }
      }
      return [];
    }
    /** CS8351: both branches of `c ? ref a : ref b` must have the same safe context. */
    refConditionalProblems(conditional) {
      const whenTrue = this.safeContext(conditional.whenTrue);
      const whenFalse = this.safeContext(conditional.whenFalse);
      if (whenTrue === whenFalse) return [];
      const inner =
        whenTrue > whenFalse
          ? this.valueEscapeProblems(conditional.whenTrue, whenFalse)
          : this.valueEscapeProblems(conditional.whenFalse, whenTrue);
      return [...inner, problem(conditional.syntax, DiagnosticId.CS8351)];
    }
    /** `destination = value` for a ref struct: the value must be allowed to live as long as the destination. */
    assignmentProblems(destination, value) {
      if (!destination?.type || !isRefLike(destination.type) || !value) return [];
      return this.valueEscapeProblems(value, this.safeContext(destination));
    }
    /** `destination = ref source`: the referent must live at least as long as the ref variable may (CS8374, CS9079). */
    refAssignmentProblems(assignment) {
      const target = this.refSafeContext(assignment.left);
      const source = this.refSafeContext(assignment.right);
      if (source <= target) return [];
      return [problem(assignment.syntax, source === EscapeScope.ReturnOnly ? DiagnosticId.CS9079 : DiagnosticId.CS8374, [describe(assignment.left), describe(assignment.right)])];
    }
  };

/** `out var x` and discards have no earlier value a callee could overwrite with something narrower. */
const isAssignableTarget = argument => argument.kind !== 'DeclarationExpression' && argument.kind !== 'Discard';

function describe(expression) {
  const e = variableOf(expression);
  if (e?.kind === 'Local') return e.local.name;
  if (e?.kind === 'Parameter') return e.parameter.name;
  if (e?.kind === 'FieldAccess') return e.field.name;
  return e?.syntax?.toString?.().trim() ?? '';
}
