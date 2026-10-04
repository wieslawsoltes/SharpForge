import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * `unsafe(expression)` (SF-A02-T92). PROVISIONAL: C# 15 preview, after csharplang/proposals/unsafe-evolution.md
 * revision 1, "unsafe expressions" (packages/syntax/src/preview-revisions.js). The pinned Roslyn does not implement
 * it, so there is no Roslyn fixture.
 *
 *   "An unsafe_expression establishes an unsafe context for evaluating its expression. ... The type and value of the
 *    unsafe_expression are the type and value of the enclosed expression."
 *   "The unsafe context established by an unsafe_expression does not extend beyond its closing parenthesis."
 *   "It is subject to the same AllowUnsafeBlocks requirement as the unsafe keyword elsewhere."  (CS0227)
 *
 * The bound node is the bound operand itself, so nothing is lowered or emitted for the expression form.
 */

/** Binder mixin: the unsafe expression. */
export const UnsafeExpressionBinding = Base =>
  class extends Base {
    expression(syntax, options = {}) {
      if (syntax.kind !== 'UnsafeExpression') return super.expression(syntax, options);
      if (!this.d.options?.allowUnsafe) this.report(syntax.unsafeKeyword, DiagnosticId.CS0227);
      this.unsafeBlocks = (this.unsafeBlocks ?? 0) + 1;
      try {
        return this.expression(syntax.expression, options);
      } finally {
        this.unsafeBlocks--;
      }
    }
  };
