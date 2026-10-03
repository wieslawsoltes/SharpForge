/**
 * C# 8 asynchronous statements and using declarations: `await foreach (...)`, `await using (...)`,
 * `await using var x = ...;` and `using var x = ...;`. The C# 1 `using (...)` statement is parsed here too because it
 * shares everything but the `await` keyword and the missing parentheses.
 */
export const asyncStatementMethods = {
  /** `await using` and `await foreach`; null when `await` starts an expression or a declaration instead. */
  awaitStatement(attributeLists) {
    const token = this.current,
      next = this.peek().kind;
    if (next !== 'using' && next !== 'foreach') return null;
    this.feature('AsyncStreams', token);
    const awaitKeyword = this.takeWord('await');
    return next === 'using' ? this.usingStatement(attributeLists, awaitKeyword) : this.forEachStatement(attributeLists, awaitKeyword);
  },
  /** `using (resource) statement`, or a using declaration when no parenthesis follows the keyword. */
  usingStatement(attributeLists, awaitKeyword) {
    const keywordToken = this.current,
      keyword = this.take();
    if (!this.at('(')) {
      this.feature('UsingDeclarations', keywordToken);
      return this.localDeclaration(attributeLists, awaitKeyword, keyword);
    }
    const open = this.take(),
      declaration = this.isLocalDeclaration() ? this.variableDeclaration() : null,
      expression = declaration ? null : this.expression();
    return this.n('UsingStatement', attributeLists, awaitKeyword, keyword, open, declaration, expression, this.expect(')'), this.embedded());
  }
};
