/**
 * Binder rules of C# 14 (SF-A02-T87).
 *
 * User-defined compound assignment operators (symbols/source/compound-operators.js):
 *
 *   x op= y;   when the type of `x` declares an applicable instance `operator op=`, the statement is the call
 *              `x.op_...Assignment(y)`: `x` is updated in place and not reassigned. Otherwise the assignment is
 *              `x = x op y` with the static operator, as before.
 *   x++; ++x;  the same with `operator ++()` / `operator --()`.
 *
 * Declaration rules: CS9308 not public, CS9310 the return type must be void, CS0106 `static` on a compound operator.
 * A compound assignment whose only candidate is an instance operator that does not apply is CS9340 on the operator.
 *
 * Limit: the instance form is used when the expression is a statement. Where the value of `x op= y` or of a prefix
 * `++x` is used, Roslyn also calls the instance operator and then reads `x`; here that use falls back to the static
 * operator and is an error when there is none (never a wrong call).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { compoundOperatorNames } from '../symbols/source/compound-operators.js';
import { lookupMembers } from './inheritance.js';

const incrementKinds = Object.freeze({
  PreIncrementExpression: '++',
  PostIncrementExpression: '++',
  PreDecrementExpression: '--',
  PostDecrementExpression: '--',
});

/** Class mixin (analysis phase): declaration rules of instance compound assignment operators. */
export const CSharp14Rules = Base =>
  class extends Base {
    checkType(type) {
      super.checkType(type);
      for (const method of type.getMembers()) {
        if (!method.isCompoundAssignmentOperator) continue;
        const uri = method.uri ?? method.locations?.[0]?.uri,
          at = method.syntax.operatorToken,
          isUnary = method.operatorToken === '++' || method.operatorToken === '--';
        if (method.isStatic && !isUnary) {
          this.report(uri, at, DiagnosticId.CS0106, ['static']);
          continue;
        }
        if (!method.syntax.modifiers.some(token => token.text === 'public')) this.report(uri, at, DiagnosticId.CS9308, [method.toDisplayString()]);
        if (!method.returnsVoid) this.report(uri, at, DiagnosticId.CS9310);
      }
    }
  };

/** Binder mixin: uses of instance compound assignment operators. */
export const CSharp14Binding = Base =>
  class extends Base {
    instanceCompoundOperators(type, name) {
      return lookupMembers(type, name, this.core, { within: this.c.containingType }).members.filter(
        member => member.kind === SymbolKind.Method && !member.isStatic && (member.originalDefinition ?? member).isCompoundAssignmentOperator,
      );
    }
    /** The applicable instance operator `name` of `target`'s type called with `args`, as a bound call, or null. */
    instanceCompoundCall(name, target, args, syntax) {
      const type = target.type;
      if (!type || target.hasErrors) return null;
      // In a checked context the `operator checked` forms are the candidates when the type declares them.
      const checkedForms = this.checked ? this.instanceCompoundOperators(type, name.replace(/^op_/, 'op_Checked')) : [],
        methods = checkedForms.length ? checkedForms : this.instanceCompoundOperators(type, name);
      if (!methods.length) return null;
      const values = args.map(argument => Object.assign(this.value(argument), { refKind: null, name: null })),
        result = this.d.overloads.resolve(methods, values, { name });
      if (!result.succeeded) return null;
      this.markRead(target);
      return this.finishCall(result, target, values, syntax, {});
    }
    assignmentTo(syntax, left) {
      // Below C# 14 an instance operator is not a candidate (its declaration is the gated construct).
      const name = this.version.number >= 14 ? compoundOperatorNames[syntax.operatorToken.text] : null;
      if (name && syntax.parent?.kind === 'ExpressionStatement') {
        const call = this.instanceCompoundCall(name, left, [syntax.right], syntax);
        if (call) return call;
      }
      const candidate = name && left.type && !left.hasErrors ? this.instanceCompoundOperators(left.type, name)[0] : null;
      if (!candidate) return super.assignmentTo(syntax, left);
      // An instance operator exists but does not apply: the static form is tried, and its failure names the candidate.
      const saved = this.quiet,
        collected = [];
      this.quiet = collected;
      let result;
      try {
        result = super.assignmentTo(syntax, left);
      } finally {
        this.quiet = saved;
      }
      for (const row of collected) {
        if (row.code === DiagnosticId.CS0019) this.report(syntax.operatorToken, DiagnosticId.CS9340, [row.args[1], row.args[2], candidate.toDisplayString()]);
        else this.report(row.node, row.code, row.args);
      }
      return result;
    }
    increment(syntax) {
      const token = incrementKinds[syntax.kind];
      // Only programs that declare an instance `++` / `--` pay for looking at the operand first.
      const declared = this.d.assembly.compoundOperators?.some(method => method.operatorToken === token);
      if (token && declared && this.version.number >= 14 && syntax.parent?.kind === 'ExpressionStatement') {
        const saved = this.quiet;
        this.quiet = [];
        let operand;
        try {
          operand = this.expression(syntax.operand);
        } finally {
          this.quiet = saved;
        }
        const call = operand.type ? this.instanceCompoundCall(compoundOperatorNames[token], operand, [], syntax) : null;
        if (call) return call;
      }
      return super.increment(syntax);
    }
  };
