/**
 * C# 9 forms that hook into older grammar: target-typed `new()` (ImplicitObjectCreation) and lambda discard
 * parameters. Static anonymous functions are recorded with the other lambda modifiers (lambdas.js).
 * Three C# 9 features need no syntax here: `nint` and `nuint` are ordinary identifiers used as type names (whether
 * they mean the native integers is decided when the name is bound), and covariant returns and module initializers
 * are an ordinary override and an ordinary attribute.
 */
const afterTupleType = new Set(['?', '[', '(']);
export const csharp9Methods = {
  /**
   * After `new`, a `(` starts the argument list of a target-typed creation unless the parentheses hold a tuple type
   * that goes on as a type: `new (int, int)?()`, `new (int, int)[2]`, `new (int, int)()`.
   */
  isImplicitObjectCreation() {
    if (!this.at('(')) return false;
    const end = this.scanTupleType(this.i);
    return !(end >= 0 && afterTupleType.has(this.kindAt(end)));
  },
  /** `new(arguments) { initializer }`; `start` is the lexer token of `new`, already consumed as `keyword`. */
  implicitObjectCreation(start, keyword) {
    this.feature('ImplicitObjectCreation', start);
    const args = this.argumentList();
    return this.n('ImplicitObjectCreationExpression', keyword, args, this.at('{') ? this.objectOrCollectionInitializer() : null);
  },
  /**
   * Records lambda discard parameters in the parameter list held by the tokens [open, close]: from the second
   * parameter named `_` on, the name is a discard rather than a duplicate parameter name.
   */
  discardParameters(open, close) {
    let discards = 0,
      depth = 0;
    for (let i = open; i <= close; i++) {
      const token = this.tokens[i],
        kind = token.kind;
      if (kind === '(' || kind === '[' || kind === '<') depth++;
      else if (kind === ')' || kind === ']' || kind === '>') depth--;
      else if (depth === 1 && this.isWord(token, '_') && (this.kindAt(i + 1) === ',' || this.kindAt(i + 1) === ')') && ++discards > 1)
        this.feature('LambdaDiscardParameters', token);
    }
  }
};
