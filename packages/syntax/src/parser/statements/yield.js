/**
 * C# 2 iterator statements: `yield return expression;` and `yield break;`. `yield` is contextual: it is a keyword only
 * directly before `return` or `break`, so locals, methods and types named `yield` keep parsing as identifiers.
 */
export const yieldStatementMethods = {
  /** Parses a yield statement, or returns null when the cursor is not at `yield return` or `yield break`. */
  yieldStatement(attributeLists) {
    const token = this.current;
    const next = this.peek().kind;
    if (!this.isWord(token, 'yield') || (next !== 'return' && next !== 'break')) return null;
    this.feature('Iterators', token);
    const yieldKeyword = this.takeWord('yield');
    const returnOrBreak = this.take();
    if (next === 'break') {
      return this.n('YieldBreakStatement', attributeLists, yieldKeyword, returnOrBreak, null, this.expect(';'));
    }
    return this.n('YieldReturnStatement', attributeLists, yieldKeyword, returnOrBreak, this.expression(), this.expect(';'));
  }
};
