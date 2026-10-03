/**
 * C# 1 try statements: `catch (T)`, `catch (T e)`, general `catch`, several catch clauses, `finally`, and C# 6 exception
 * filters. A try without catch or finally reports CS1524 and keeps the statement.
 */
export const tryStatementMethods = {
  tryStatement(attrs) {
    const start = this.current,
      keyword = this.take(),
      block = this.block(),
      catches = [];
    while (this.at('catch')) {
      const catchKeyword = this.take();
      let declaration = null,
        filter = null;
      if (this.at('(')) {
        const open = this.take(),
          type = this.type();
        declaration = this.n('CatchDeclaration', open, type, this.isId() ? this.take('IdentifierToken') : null, this.expect(')'));
      }
      if (this.atWord('when') && this.peek().kind === '(') {
        this.feature('ExceptionFilter', this.current);
        filter = this.n('CatchFilterClause', this.takeWord('when'), this.take(), this.expression(), this.expect(')'));
      }
      catches.push(this.n('CatchClause', catchKeyword, declaration, filter, this.block()));
    }
    const final = this.at('finally') ? this.n('FinallyClause', this.take(), this.block()) : null;
    if (!catches.length && !final) this.error(start, 'CS1524', 'Expected catch or finally');
    return this.n('TryStatement', attrs, keyword, block, catches, final);
  }
};
