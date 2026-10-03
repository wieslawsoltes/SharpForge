/** Generic type-parameter lists (with C# 4 in/out variance) and `where` constraint clauses on types, methods and delegates. */
export const typeParameterMethods = {
  typeParameterList() {
    const open = this.take(),
      parameters = [];
    this.feature('Generics', this.tokens[this.i - 1]);
    while (!this.at('>') && !this.at('eof')) {
      const before = this.i,
        attributeLists = this.attributeLists(),
        variance = this.atAny(['in', 'out']) ? this.take() : null;
      if (variance) this.feature('TypeVariance', this.tokens[this.i - 1]);
      parameters.push(this.n('TypeParameter', attributeLists, variance, this.id()));
      if (this.at(',')) parameters.push(this.take());
      else break;
      if (before === this.i) break;
    }
    return this.n('TypeParameterList', open, parameters, this.expect('>'));
  },
  /** Zero or more `where T : constraint, ...` clauses. */
  constraintClauses() {
    const clauses = [];
    while (this.atWord('where') && this.isId(this.peek()) && this.peek(2).kind === ':') {
      const where = this.takeWord('where'),
        name = this.n('IdentifierName', this.id()),
        colon = this.take(),
        constraints = [];
      for (;;) {
        const before = this.i;
        constraints.push(this.typeParameterConstraint());
        if (this.at(',')) constraints.push(this.take());
        else break;
        if (before === this.i) break;
      }
      clauses.push(this.n('TypeParameterConstraintClause', where, name, colon, constraints));
    }
    return clauses;
  },
  typeParameterConstraint() {
    if (this.at('new') && this.peek().kind === '(') return this.n('ConstructorConstraint', this.take(), this.take(), this.expect(')'));
    if (this.at('class') || this.at('struct')) {
      const keyword = this.take(),
        kind = keyword.kind === 'ClassKeyword' ? 'ClassConstraint' : 'StructConstraint';
      return this.n(kind, keyword, this.match('?'));
    }
    if (this.at('default')) {
      this.feature('DefaultTypeParameterConstraint', this.current);
      return this.n('DefaultConstraint', this.take());
    }
    if (this.atWord('allows') && this.peek().kind === 'ref') {
      this.feature('AllowsRefStructConstraint', this.current);
      const allows = this.takeWord('allows'),
        list = [];
      for (;;) {
        list.push(this.n('RefStructConstraint', this.expect('ref'), this.expect('struct')));
        if (this.at(',') && this.peek().kind === 'ref') list.push(this.take());
        else break;
      }
      return this.n('AllowsConstraintClause', allows, list);
    }
    return this.n('TypeConstraint', this.type());
  }
};
