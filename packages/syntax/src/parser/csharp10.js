/**
 * C# 10 forms that hook into older grammar: attributes and explicit return types on lambdas, deconstruction that
 * mixes declarations with existing variables (`(x, var y) = e`), and parameterless constructors and field
 * initializers in structs. Each is recorded where Roslyn reports it.
 */
const nonInstance = new Set(['static', 'const']);
export const csharp10Methods = {
  /** The index after the attribute lists that start at `i`, or -1 when a bracket is unbalanced. */
  afterAttributeLists(i) {
    while (this.kindAt(i) === '[') {
      const close = this.matchingBracket(i);
      if (close < 0) return -1;
      i = close + 1;
    }
    return i;
  },
  /** Attribute lists on a lambda or on one of its parameters; each list is one feature use. */
  lambdaAttributeLists() {
    const lists = [];
    while (this.at('[')) {
      const open = this.current;
      lists.push(this.attributeList());
      this.feature('LambdaAttributes', open, this.tokens[this.i - 1]);
    }
    return lists;
  },
  /** The explicit return type of a lambda: `int (int x) => x`. */
  lambdaReturnType() {
    const start = this.current,
      type = this.type();
    this.feature('LambdaReturnType', start, this.tokens[this.i - 1]);
    return type;
  },
  /**
   * Called for `tuple = value`, whose tokens start at index `start`: records the feature when the tuple both declares
   * variables and assigns existing ones. Roslyn reports it over the whole assignment.
   */
  mixedDeconstruction(tuple, start) {
    const found = { declarations: 0, expressions: 0 };
    this.countTupleElements(tuple, found);
    if (found.declarations && found.expressions) this.feature('MixedDeclarationsAndExpressionsInDeconstruction', this.tokens[start], this.tokens[this.i - 1]);
  },
  countTupleElements(tuple, found) {
    for (const child of tuple.children[1].children) {
      if (child.kind !== 'Argument') continue;
      const expression = child.children[2];
      if (expression.kind === 'TupleExpression') this.countTupleElements(expression, found);
      else if (expression.kind === 'DeclarationExpression') found.declarations++;
      else found.expressions++;
    }
  },
  /** True when the member being parsed is an instance member of a plain struct (not static, not const). */
  isStructInstanceMember() {
    if (this.containerKind !== 'StructDeclaration') return false;
    for (let i = this.memberModifiers; i < this.memberModifiersEnd; i++) if (nonInstance.has(this.tokens[i].kind)) return false;
    return true;
  },
  /** An instance field or auto-property of a struct with an initializer; `nameToken` is its name. */
  structFieldInitializer(nameToken) {
    if (this.isStructInstanceMember()) this.feature('StructFieldInitializers', nameToken);
  },
  /** A constructor whose parameter list is empty, in a struct; the cursor is at its name. */
  structConstructor() {
    if (this.kindAt(this.i + 2) === ')' && this.isStructInstanceMember()) this.feature('ParameterlessStructConstructors', this.current);
  }
};
