/**
 * Symbols of C# 14 user-defined compound assignment operators (SF-A02-T87): instance operators that update the
 * receiver in place.
 *
 *   public void operator +=(T x)   an instance method `op_AdditionAssignment(T x)`
 *   public void operator ++()      an instance method `op_IncrementAssignment()`
 *
 * They are ordinary instance methods under the metadata names the language defines, marked
 * `isCompoundAssignmentOperator`; the static operator rules (public static, operand of the containing type, a
 * non-void result) do not apply to them. binder/csharp14.js checks their own rules and binds their uses.
 */
import { MethodKind } from '../members.js';
import { words } from './source-type.js';

/** Operator token to metadata name, for the instance forms. */
export const compoundOperatorNames = Object.freeze({
  '+=': 'op_AdditionAssignment',
  '-=': 'op_SubtractionAssignment',
  '*=': 'op_MultiplicationAssignment',
  '/=': 'op_DivisionAssignment',
  '%=': 'op_ModulusAssignment',
  '&=': 'op_BitwiseAndAssignment',
  '|=': 'op_BitwiseOrAssignment',
  '^=': 'op_ExclusiveOrAssignment',
  '<<=': 'op_LeftShiftAssignment',
  '>>=': 'op_RightShiftAssignment',
  '>>>=': 'op_UnsignedRightShiftAssignment',
  '++': 'op_IncrementAssignment',
  '--': 'op_DecrementAssignment',
});

/** True for an operator declaration in instance form: a compound token, or `++` / `--` without `static`. */
export function isInstanceOperatorDeclaration(syntax) {
  if (syntax.kind !== 'OperatorDeclaration') return false;
  const token = syntax.operatorToken.text;
  if (!Object.hasOwn(compoundOperatorNames, token)) return false;
  if (token !== '++' && token !== '--') return true;
  // `operator ++(T x)` with a parameter is the static form (and is reported as such when `static` is missing).
  return !words(syntax.modifiers).includes('static') && syntax.parameterList.parameters.length === 0;
}

/** Class mixin for the source assembly: instance compound assignment operators. */
export const CompoundOperatorSymbols = Base =>
  class extends Base {
    member(type, syntax, scope, uri, members) {
      if (!isInstanceOperatorDeclaration(syntax)) return super.member(type, syntax, scope, uri, members);
      const token = syntax.operatorToken.text,
        name = compoundOperatorNames[token].replace(/^op_/, syntax.checkedKeyword ? 'op_Checked' : 'op_'),
        method = this.method(type, syntax, scope, uri, { name, kind: MethodKind.Ordinary, returnTypeSyntax: syntax.returnType });
      method.operatorToken = token;
      method.isCompoundAssignmentOperator = true;
      (this.compoundOperators ??= []).push(method);
      members.push(method);
    }
  };
