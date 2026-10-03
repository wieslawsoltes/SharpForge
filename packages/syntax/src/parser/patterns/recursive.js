/** C# 8 recursive patterns: positional `T(a, b)`, property `{ P: p }`, a trailing designation, and C# 10 extended property names `{ A.B: p }`. */
export const recursivePatternMethods = {
  /** Parses the positional and/or property clauses (cursor at `(` or `{`) and an optional designation. */
  recursivePattern(type, positional = null) {
    const start = this.current;
    let property = null;
    if (!positional && this.at('(')) {
      const open = this.take(),
        list = this.subpatterns(')');
      positional = this.n('PositionalPatternClause', open, list, this.expect(')'));
    }
    if (this.at('{')) {
      const open = this.take(),
        list = this.subpatterns('}');
      property = this.n('PropertyPatternClause', open, list, this.expect('}'));
    }
    this.feature('RecursivePatterns', start);
    return this.n('RecursivePattern', type, positional, property, this.isDesignationAhead() ? this.designation() : null);
  },
  /** Index after a dotted name at `i` when it is followed by `:` (a subpattern name), else -1. */
  scanSubpatternName(i) {
    if (!this.isId(this.tokens[i])) return -1;
    i++;
    while (this.kindAt(i) === '.' && this.isId(this.tokens[i + 1])) i += 2;
    return this.kindAt(i) === ':' ? i : -1;
  },
  subpatterns(close) {
    const list = [],
      when = this.patternWhen;
    this.nested(() => {
      while (!this.at(close) && !this.at('eof')) {
        const before = this.i,
          colon = this.scanSubpatternName(this.i);
        let name = null;
        if (colon === this.i + 1) name = this.n('NameColon', this.n('IdentifierName', this.id()), this.take());
        else if (colon > 0) {
          this.feature('ExtendedPropertyPatterns', this.current);
          let expression = this.n('IdentifierName', this.id());
          while (this.at('.')) expression = this.n('SimpleMemberAccessExpression', expression, this.take(), this.n('IdentifierName', this.id()));
          name = this.n('ExpressionColon', expression, this.take());
        }
        list.push(this.n('Subpattern', name, this.pattern(false)));
        if (this.at(',')) list.push(this.take());
        else break;
        if (before === this.i) break;
      }
    });
    this.patternWhen = when;
    return list;
  }
};
