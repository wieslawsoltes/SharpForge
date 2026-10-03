/** C# 7 tuple literals, parenthesised expressions, declaration expressions and deconstruction designations. Tuple types live in types.js. */
export const tupleMethods = {
  /** `(e)` is a ParenthesizedExpression; two or more elements, or a named element, make a TupleExpression. */
  parenthesizedOrTuple() {
    const start = this.current,
      open = this.take(),
      saved = this.tupleContext;
    let args = [];
    this.nested(() => {
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
    const close = this.expect(')'),
      first = args[0];
    if (args.length === 1 && !first.children[0] && !first.children[1]) return this.n('ParenthesizedExpression', open, first.children[2], close);
    this.feature('Tuples', start);
    return this.n('TupleExpression', open, args, close);
  },
  /** A type followed by a designation and then `,`, `)` or `=`: `out int x`, `(int a, var b)`. */
  isDeclarationExpressionAhead(i = this.i) {
    if (this.kindAt(i) === 'await') return false;
    const end = this.scanType(i);
    if (end <= i) return false;
    const first = this.tupleFirst;
    this.tupleFirst = false;
    // No pointer types in tuple declarations: `(a * b, c)` multiplies.
    if (this.tupleContext && this.kindAt(end - 1) === '*') return false;
    return this.isId(this.tokens[end]) && (first ? [','] : [',', ')', '=']).includes(this.kindAt(end + 1));
  },
  scanDesignation(i) {
    if (this.kindAt(i) !== '(') return this.isId(this.tokens[i]) ? i + 1 : -1;
    i++;
    for (let guard = 0; guard < 256; guard++) {
      i = this.scanDesignation(i);
      if (i < 0) return -1;
      if (this.kindAt(i) === ',') {
        i++;
        continue;
      }
      return this.kindAt(i) === ')' ? i + 1 : -1;
    }
    return -1;
  },
  /** `var (a, (b, c))` followed by `=` or `in` is a deconstruction declaration rather than a call to a method named var. */
  isDeconstructionAhead(i = this.i) {
    const end = this.scanDesignation(i + 1);
    return end > 0 && (this.kindAt(end) === '=' || this.kindAt(end) === 'in');
  },
  declarationExpression() {
    const type = this.type();
    return this.n('DeclarationExpression', type, this.designation());
  },
  designation() {
    if (this.at('(')) {
      const open = this.take(),
        list = [];
      for (;;) {
        const before = this.i;
        list.push(this.designation());
        if (this.at(',')) list.push(this.take());
        else break;
        if (before === this.i) break;
      }
      return this.n('ParenthesizedVariableDesignation', open, list, this.expect(')'));
    }
    if (this.atWord('_')) return this.n('DiscardDesignation', this.take('UnderscoreToken'));
    return this.n('SingleVariableDesignation', this.id());
  }
};
