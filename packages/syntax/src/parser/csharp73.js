/**
 * C# 7.3 forms that hook into older grammar: `[field: Attr]` on an auto-property (the attribute goes to the
 * compiler-generated backing field; field-like events always allowed it), and expression variables (`out var x`, `is T x`) in field and
 * property initializers, constructor initializers and query clauses.
 * The 7.3 constraints `unmanaged`, `System.Enum` and `System.Delegate` are ordinary type constraints syntactically;
 * whether they are the special constraint is decided when the name is bound.
 */
export const csharp73Methods = {
  /** Records the feature for every `[field: ...]` attribute list among those starting at token index `from`. */
  backingFieldAttributes(from) {
    for (let i = from; this.kindAt(i) === '['; ) {
      if (this.isWord(this.tokens[i + 1], 'field') && this.kindAt(i + 2) === ':') this.feature('AttributesOnBackingFields', this.tokens[i + 1], this.tokens[i + 2]);
      const close = this.matchingBracket(i);
      if (close < 0) return;
      i = close + 1;
    }
  },
  /**
   * Runs `parse` (a parser method) as an initializer or query clause, where declaring an expression variable needs
   * C# 7.3. Blocks and lambda bodies inside are ordinary scopes again (see block() and lambdas.js).
   */
  inInitializer(parse) {
    const saved = this.restrictedVariables;
    this.restrictedVariables = true;
    try {
      return parse.call(this);
    } finally {
      this.restrictedVariables = saved;
    }
  },
  /** Called for each expression variable declared; `start` and `end` are the first and last tokens of its declaration. */
  expressionVariable(start, end = start) {
    if (this.restrictedVariables) this.feature('ExpressionVariablesInQueriesAndInitializers', start, end);
  }
};
