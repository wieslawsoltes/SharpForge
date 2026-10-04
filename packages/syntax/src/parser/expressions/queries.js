/** C# 3 query expressions: from, let, where, join (into), orderby, select, group by and `into` continuations. Clause words are contextual. */
export const queryMethods = {
  /** `from` starts a query only in the shape `from [type] identifier in`; elsewhere it stays an identifier. */
  isQueryStart(i = this.i) {
    if (this.isId(this.tokens[i + 1]) && this.kindAt(i + 2) === 'in') return true;
    const end = this.scanType(i + 1);
    return end > i + 1 && this.isId(this.tokens[end]) && this.kindAt(end + 1) === 'in';
  },
  /**
   * The collection of the first `from` clause and the collection of a `join` are evaluated where the query stands, so
   * an expression variable declared there is an ordinary one. Every other clause expression becomes a lambda body,
   * where declaring one needs C# 7.3 (see csharp73.js).
   */
  queryExpression() {
    this.feature('QueryExpression', this.current);
    this.queryDepth = (this.queryDepth ?? 0) + 1;
    const from = this.fromClause(),
      enclosing = this.queryEnclosing;
    this.queryEnclosing = this.restrictedVariables;
    this.restrictedVariables = 'clause';
    const query = this.n('QueryExpression', from, this.queryBody());
    this.restrictedVariables = this.queryEnclosing;
    this.queryEnclosing = enclosing;
    this.queryDepth--;
    return query;
  },
  /** The collection of a join clause, parsed in the state of the code around the query. */
  joinSource() {
    const clause = this.restrictedVariables;
    this.restrictedVariables = this.queryEnclosing;
    const source = this.expression();
    this.restrictedVariables = clause;
    return source;
  },
  rangeVariable() {
    const typed = !(this.isId() && this.peek().kind === 'in');
    const type = typed ? this.type() : null;
    return [type, this.id()];
  },
  fromClause() {
    const keyword = this.takeWord('from'),
      [type, identifier] = this.rangeVariable();
    return this.n('FromClause', keyword, type, identifier, this.expect('in'), this.expression());
  },
  queryBody() {
    const clauses = [];
    for (;;) {
      if (this.atWord('from') && this.isQueryStart()) clauses.push(this.fromClause());
      else if (this.atWord('let')) clauses.push(this.n('LetClause', this.takeWord('let'), this.id(), this.expect('='), this.expression()));
      else if (this.atWord('where')) clauses.push(this.n('WhereClause', this.takeWord('where'), this.expression()));
      else if (this.atWord('join')) {
        const keyword = this.takeWord('join'),
          [type, identifier] = this.rangeVariable(),
          inKeyword = this.expect('in'),
          source = this.joinSource();
        const on = this.contextual('on'),
          left = this.expression(),
          equals = this.contextual('equals'),
          right = this.expression();
        clauses.push(
          this.n(
            'JoinClause',
            keyword,
            type,
            identifier,
            inKeyword,
            source,
            on,
            left,
            equals,
            right,
            this.atWord('into') ? this.n('JoinIntoClause', this.takeWord('into'), this.id()) : null
          )
        );
      } else if (this.atWord('orderby')) {
        const keyword = this.takeWord('orderby'),
          orderings = [];
        for (;;) {
          const expression = this.expression(),
            direction = this.atWord('ascending') ? this.takeWord('ascending') : this.atWord('descending') ? this.takeWord('descending') : null;
          orderings.push(this.n(direction?.kind === 'DescendingKeyword' ? 'DescendingOrdering' : 'AscendingOrdering', expression, direction));
          if (this.at(',')) orderings.push(this.take());
          else break;
        }
        clauses.push(this.n('OrderByClause', keyword, orderings));
      } else break;
    }
    let selectOrGroup;
    if (this.atWord('select')) selectOrGroup = this.n('SelectClause', this.takeWord('select'), this.expression());
    else if (this.atWord('group')) {
      const keyword = this.takeWord('group'),
        group = this.expression();
      selectOrGroup = this.n('GroupClause', keyword, group, this.contextual('by'), this.expression());
    } else {
      this.error(this.current, 'CS0742', 'A query body must end with a select clause or a group clause');
      selectOrGroup = this.n('SelectClause', this.cache.missing('SelectKeyword'), this.missingName());
    }
    const continuation = this.atWord('into') ? this.n('QueryContinuation', this.takeWord('into'), this.id(), this.queryBody()) : null;
    return this.n('QueryBody', clauses, selectOrGroup, continuation);
  },
  /** Expects a contextual keyword, producing a missing token with CS1003 when absent. */
  contextual(word) {
    if (this.atWord(word)) return this.takeWord(word);
    this.error(this.current, 'CS1003', `Syntax error, '${word}' expected`);
    return this.cache.missing(word[0].toUpperCase() + word.slice(1) + 'Keyword');
  }
};
