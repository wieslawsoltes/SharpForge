/**
 * C# 7 declaration expressions and designations: `out var x`, `out T x`, `out _`, the typed elements of a
 * deconstruction (`(int a, var b) = e`) and `var (a, (b, c)) = e`. A designation is a name, the discard `_`, or a
 * parenthesised list of designations.
 */
export const declarationExpressionMethods = {
  /**
   * In a tuple: a type and a designation followed by `,` (or by `)` after the first element), as in
   * `(int a, var b)` and `(x, var (y, z))`. Only `var` and predefined types take a parenthesised designation.
   */
  isDeclarationExpressionAhead(i = this.i) {
    const end = this.scanDeclaredType(i);
    if (end <= i) return false;
    // No pointer types in tuple declarations: `(a * b, c)` multiplies.
    if (this.tupleContext && this.kindAt(end - 1) === '*') return false;
    const nested = this.kindAt(end) === '(' && end === i + 1 && (this.isWord(this.tokens[i], 'var') || this.isPredefined(this.tokens[i])),
      after = nested ? this.scanDesignation(end) : this.isId(this.tokens[end]) ? end + 1 : -1;
    if (after < 0) return false;
    const follower = this.kindAt(after);
    return follower === ',' || (follower === ')' && !this.tupleFirst);
  },
  /** After `out`: a type followed by a name declares a variable, whatever follows it (Roslyn's rule; `out a.b` is an expression). */
  isOutDeclarationAhead(i = this.i) {
    const end = this.scanDeclaredType(i);
    return end > i && this.isId(this.tokens[end]);
  },
  /** The index after a type that can start a declaration expression at `i`, or -1. `await` is an operator in async code, not a type. */
  scanDeclaredType(i) {
    if (this.kindAt(i) === 'await' && this.inAsync) return -1;
    return this.scanType(i);
  },
  /** The index after the designation at `i` (a name or a parenthesised list of designations), or -1. */
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
  /** The expression of an `out` argument: a declaration (`out var x`, `out int _`) or any other expression. `outToken` is the keyword. */
  outArgumentExpression(outToken) {
    if (!this.isOutDeclarationAhead()) return this.expression();
    this.feature('OutVar', outToken);
    return this.declarationExpression();
  },
  declarationExpression() {
    const start = this.current,
      type = this.type(),
      designation = this.designation(false);
    // Roslyn names the whole declaration in an initializer but only the variable in a query clause.
    this.expressionVariable(this.restrictedVariables === 'clause' ? this.tokens[this.i - 1] : start, this.tokens[this.i - 1]);
    return this.n('DeclarationExpression', type, designation);
  },
  /** A designation. `report` is false when the caller records the expression variable for the whole declaration itself. */
  designation(report = true) {
    if (this.at('(')) {
      const open = this.take(),
        list = [];
      for (;;) {
        const before = this.i;
        list.push(this.designation(report));
        if (this.at(',')) list.push(this.take());
        else break;
        if (before === this.i) break;
      }
      return this.n('ParenthesizedVariableDesignation', open, list, this.expect(')'));
    }
    if (this.atWord('_')) return this.n('DiscardDesignation', this.take('UnderscoreToken'));
    if (report) this.expressionVariable(this.current);
    return this.n('SingleVariableDesignation', this.id());
  }
};
