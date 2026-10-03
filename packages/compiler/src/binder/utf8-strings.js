import {DiagnosticId} from '../diagnostics/codes.js';
/**
 * UTF-8 string literals (C# 11, SF-A02-T77). `"text"u8` is a `ReadOnlySpan<byte>` over the UTF-8 bytes of the text;
 * it is not a `string`, a `byte[]` or an `object`, and no conversion to them exists (CS0029 through the ordinary
 * conversion rules). `+` joins two UTF-8 literals into one; with any other operand it is CS0019.
 *
 * Bound node: `Utf8Literal { text }` of type `ReadOnlySpan<byte>`. It is not executable: the runtime has no spans, so
 * code generation reports the construct (SF2200). The lexer reports text that has no UTF-8 form (CS9026).
 */

/** True for the syntax of a UTF-8 literal or of a concatenation of UTF-8 literals. */
function isUtf8Syntax(syntax) {
  if (syntax.kind === 'ParenthesizedExpression') return isUtf8Syntax(syntax.expression);
  if (syntax.kind === 'AddExpression') return isUtf8Syntax(syntax.left) && isUtf8Syntax(syntax.right);
  return syntax.kind === 'Utf8StringLiteralExpression';
}

/** Class mixin of the body binder. */
export const Utf8StringBinding = Base =>
  class extends Base {
    expression(syntax, options = {}) {
      if (syntax.kind !== 'Utf8StringLiteralExpression') return super.expression(syntax, options);
      return this.utf8Literal(syntax, syntax.token.value ?? '');
    }
    binary(syntax, operator) {
      const utf8Left = isUtf8Syntax(syntax.left),
        utf8Right = isUtf8Syntax(syntax.right);
      if (operator !== '+' || (!utf8Left && !utf8Right)) return super.binary(syntax, operator);
      if (utf8Left !== utf8Right) {
        // A UTF-8 literal is joined with another UTF-8 literal only: it is not text, so string concatenation does not apply.
        const operands = [this.value(syntax.left), this.value(syntax.right)];
        if (operands.every(operand => !operand.hasErrors && operand.type))
          this.report(syntax, DiagnosticId.CS0019, ['+', ...operands.map(operand => this.display(operand.type))]);
        return this.bad(syntax);
      }
      const left = this.value(syntax.left),
        right = this.value(syntax.right);
      if (left.kind !== 'Utf8Literal' || right.kind !== 'Utf8Literal') return this.bad(syntax);
      return this.utf8Literal(syntax, left.text + right.text);
    }
    utf8Literal(syntax, text) {
      const type = this.core.readOnlySpan.construct([this.core.byte]);
      // A local that only ever holds a single UTF-8 literal is "assigned but never used" (CS0219), like one holding a constant.
      return this.node('Utf8Literal', syntax, type, { text, isCompileTimeValue: syntax.kind === 'Utf8StringLiteralExpression' });
    }
  };
