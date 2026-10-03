/** C# 7 tuple literals and parenthesised expressions. Tuple types live in types.js, declaration expressions in declaration-expressions.js. */
export const tupleMethods = {
  /** `(e)` is a ParenthesizedExpression; two or more elements, or a named element, make a TupleExpression. */
  parenthesizedOrTuple() {
    const start = this.current,
      open = this.take(),
      saved = this.tupleContext;
    let args = [];
    this.nested(() => {
      // Roslyn: every element of a tuple literal may be a declaration, whatever follows the tuple (`var w = (var (x, y), 2);`).
      this.tupleContext = true;
      for (;;) {
        const before = this.i;
        // Roslyn: the first element is a declaration only when a comma follows, so `(a * b)` stays a multiplication.
        this.tupleFirst = args.length === 0;
        args.push(this.argument());
        this.tupleFirst = false;
        if (this.at(',')) args.push(this.take());
        else break;
        if (before === this.i) break;
      }
    });
    this.tupleContext = saved;
    this.tupleFirst = false;
    const close = this.expect(')'),
      first = args[0];
    if (args.length === 1 && !first.children[0] && !first.children[1]) return this.n('ParenthesizedExpression', open, first.children[2], close);
    this.feature('Tuples', start, this.tokens[this.i - 1]);
    return this.n('TupleExpression', open, args, close);
  }
};
