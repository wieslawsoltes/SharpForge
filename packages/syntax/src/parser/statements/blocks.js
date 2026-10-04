/**
 * C# 1 block-like statements: `lock`, `checked` / `unchecked` / `unsafe` blocks and `switch` with sections that keep
 * every label and statement in order (fall-through is a binder diagnostic, not a parser one).
 */
import { Precedence } from '../../lexer/operators.js';

export const blockStatementMethods = {
  lockStatement(attributeLists) {
    const keyword = this.take();
    const open = this.expect('(');
    const expression = this.expression();
    return this.n('LockStatement', attributeLists, keyword, open, expression, this.expect(')'), this.embedded());
  },
  /** `checked { }` or `unchecked { }`; null when the keyword starts a checked expression instead. */
  checkedStatement(attributeLists) {
    if (this.peek().kind !== '{') return null;
    const kind = this.current.kind === 'checked' ? 'CheckedStatement' : 'UncheckedStatement';
    return this.n(kind, attributeLists, this.take(), this.block());
  },
  /** `unsafe { }`; null when `unsafe` is a modifier of a local function or starts an unsafe expression. */
  unsafeStatement(attributeLists) {
    if (this.peek().kind !== '{') return null;
    return this.n('UnsafeStatement', attributeLists, this.take(), this.block());
  },
  switchStatement(attrs) {
    const keyword = this.take(),
      [open, expression, close] = this.switchGoverningExpression(),
      brace = this.expect('{'),
      sections = [];
    while (!this.at('}') && !this.at('eof')) {
      const before = this.i,
        labels = [],
        statements = [];
      while (this.at('case') || (this.at('default') && this.peek().kind === ':')) labels.push(this.switchLabel());
      if (!labels.length) {
        this.skipUnexpected('CS1525', 'case or default expected');
        continue;
      }
      while (!this.atAny(['case', '}', 'eof']) && !(this.at('default') && this.peek().kind === ':')) {
        const at = this.i;
        statements.push(this.statement());
        this.guardProgress(at);
      }
      sections.push(this.n('SwitchSection', labels, statements));
      this.guardProgress(before);
    }
    return this.n('SwitchStatement', attrs, keyword, open, expression, close, brace, sections, this.expect('}'));
  },
  /**
   * `( expression )` of a switch statement as `[open, expression, close]`. C# 8: `switch (a, b)` governs on a tuple
   * literal whose parentheses are the statement's; as in Roslyn the statement then has no
   * parenthesis tokens of its own.
   */
  switchGoverningExpression() {
    const start = this.current,
      open = this.expect('('),
      first = this.argument(),
      isPlain = !first.children[0] && !first.children[1];
    if (isPlain && !this.at(',')) return [open, first.children[2], this.expect(')')];
    const elements = [first];
    while (this.at(',')) {
      const before = this.i;
      elements.push(this.take());
      elements.push(this.argument());
      if (before === this.i) break;
    }
    const close = this.expect(')');
    this.feature('Tuples', start, close);
    return [null, this.n('TupleExpression', open, elements, close), null];
  },
  switchLabel() {
    const keyword = this.take();
    if (keyword.kind === 'DefaultKeyword') return this.n('DefaultSwitchLabel', keyword, this.expect(':'));
    const start = this.current,
      pattern = this.pattern(true, Precedence.Conditional),
      when = this.atWord('when') ? this.n('WhenClause', this.takeWord('when'), this.expression()) : null;
    if (pattern.kind === 'ConstantPattern' && !when) return this.n('CaseSwitchLabel', keyword, pattern.children[0], this.expect(':'));
    this.feature('PatternMatching', start);
    return this.n('CasePatternSwitchLabel', keyword, pattern, when, this.expect(':'));
  }
};
