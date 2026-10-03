import { Precedence } from '../../lexer/operators.js';
import { declarationModifiers } from '../modifiers.js';
/**
 * C# 5 `async` and `await`, both contextual. `await` is an operator inside async functions and top-level statements;
 * elsewhere it is an identifier unless the next token could not follow an identifier, in which case it is still parsed
 * as an operator so the binder can report the missing `async`. `async` is a modifier only when a declaration follows.
 */
const operandStarts = new Set(['new', 'this', 'base', 'delegate', 'typeof', 'checked', 'unchecked', 'default', 'true', 'false', 'null']);
const literalStarts = new Set(['integer', 'double', 'string', 'char', 'interpolated']);
const typeDeclarationStarts = new Set(['class', 'struct', 'interface', 'enum', 'delegate', 'event']);
const incompleteMemberFollowers = new Set(['eof', '}', 'namespace']);
export const awaitMethods = {
  /** True when the `await` at the cursor is the operator rather than an identifier named await. */
  isAwaitExpression() {
    const token = this.current;
    if (token.kind !== 'await' || token.flags) return false;
    if (this.inAsync) return true;
    const next = this.peek();
    if (this.isId(next)) return !this.isWord(next, 'with');
    return operandStarts.has(next.kind) || literalStarts.has(next.kind);
  },
  awaitExpression() {
    this.feature('Async', this.current);
    return this.n('AwaitExpression', this.takeWord('await'), this.expression(Precedence.Unary));
  },
  /** A reserved modifier keyword (not one of the contextual words `async` and `partial`). */
  isReservedModifier(token) {
    return declarationModifiers.has(token.kind) && token.kind !== 'async' && token.kind !== 'partial' && token.kind !== 'fixed';
  },
  /**
   * True when the `async` at `index` is a modifier: a reserved modifier or a type declaration follows, or a type and
   * then a member name (`async Task M`). In `async M()` and `async x;` the word is the return or field type.
   * `member` is false for local functions, where `partial` and type declarations cannot follow.
   */
  isAsyncModifier(index, member = true) {
    if (this.tokens[index].flags) return false;
    let next = index + 1;
    if (this.isReservedModifier(this.tokens[next])) return true;
    if (member && this.kindAt(next) === 'partial') next++;
    const kind = this.kindAt(next);
    if (member && (typeDeclarationStarts.has(kind) || ((kind === 'explicit' || kind === 'implicit') && this.kindAt(next + 1) === 'operator')))
      return true;
    const end = this.scanType(next);
    if (end <= next) return false;
    const after = this.tokens[end];
    if (this.isId(after) || after.kind === 'this') return true;
    if (after.kind === 'operator') return member;
    return incompleteMemberFollowers.has(after.kind) || this.isPredefined(after) || this.isReservedModifier(after) || typeDeclarationStarts.has(after.kind);
  }
};
