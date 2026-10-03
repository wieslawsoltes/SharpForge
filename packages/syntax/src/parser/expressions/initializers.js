/**
 * Brace initializers: array initializers (which nest), object initializers with member and C# 6 indexer assignments,
 * collection initializers with `{ key, value }` elements, and the initializer of a `with` expression.
 */
export const initializerMethods = {
  /** `{ a, b }` initializers. Array initializers nest; `with` and object initializers hold assignments. */
  initializerExpression(kind) {
    const open = this.expect('{'),
      list = [];
    if (!this.enter('Initializer nesting limit exceeded')) {
      this.leave();
      return this.n(kind, open, list, this.expect('}'));
    }
    this.nested(() => {
      while (!this.at('}') && !this.at('eof')) {
        const before = this.i;
        if (kind === 'ArrayInitializerExpression') list.push(this.variableInitializer());
        else if (kind === 'ObjectInitializerExpression' || kind === 'WithInitializerExpression') list.push(this.memberInitializer());
        else list.push(this.at('{') ? this.initializerExpression('ComplexElementInitializerExpression') : this.expression());
        const comma = this.separator(this.canStartInitializerElement);
        if (!comma || before === this.i) break;
        list.push(comma);
      }
    });
    this.leave();
    return this.n(kind, open, list, this.expect('}'));
  },
  canStartInitializerElement() {
    return this.at('{') || this.canStartExpression();
  },
  memberInitializer() {
    const start = this.current;
    let target;
    if (this.at('[')) {
      this.feature('DictionaryInitializer', start);
      target = this.n('ImplicitElementAccess', this.bracketedArgumentList());
    } else if (this.isId() && this.peek().kind === '=') target = this.n('IdentifierName', this.id());
    else return this.expression();
    const equals = this.expect('='),
      value = this.at('{') ? this.objectOrCollectionInitializer() : this.expression();
    return this.n('SimpleAssignmentExpression', target, equals, value);
  },
  objectOrCollectionInitializer() {
    const next = this.peek(),
      object =
        next.kind === '}' ||
        (next.kind === '[' && this.kindAt(this.matchingBracket(this.i + 1) + 1) === '=') ||
        (this.isId(next) && this.kindAt(this.i + 2) === '=');
    this.feature(object ? 'ObjectInitializer' : 'CollectionInitializer', this.current);
    return this.initializerExpression(object ? 'ObjectInitializerExpression' : 'CollectionInitializerExpression');
  }
};
