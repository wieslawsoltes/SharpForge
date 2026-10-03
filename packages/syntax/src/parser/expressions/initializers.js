/**
 * Brace initializers: array initializers (which nest), C# 3 object initializers with nested member initializers and
 * C# 6 index initializers, collection initializers with `{ key, value }` elements, and the initializer of a `with`
 * expression. They apply to any type: the parser never needs to know what is being created.
 */
export const initializerMethods = {
  /**
   * `{ element, element, }`: returns [openBrace, elementsAndCommas, closeBrace]. A trailing comma is allowed and a
   * missing comma is recovered when another element can start (see separator in recovery.js).
   */
  braceList(parseElement) {
    const open = this.expect('{'),
      list = [];
    if (this.enter('Initializer nesting limit exceeded'))
      this.nested(() => {
        while (!this.at('}') && !this.at('eof')) {
          // After a comma the list goes on only with another element (or another comma, which reports the missing one).
          if (list.length && !this.at(',') && !this.canStartInitializerElement()) break;
          const before = this.i;
          list.push(parseElement.call(this));
          const comma = this.separator(this.canStartInitializerElement);
          if (!comma || before === this.i) break;
          list.push(comma);
        }
      });
    this.leave();
    return [open, list, this.expect('}')];
  },
  canStartInitializerElement() {
    return this.at('{') || this.canStartExpression();
  },
  /** An array initializer (elements nest), a `with` initializer (assignments) or a `{ a, b }` collection element. */
  initializerExpression(kind) {
    const element =
      kind === 'ArrayInitializerExpression' ? this.variableInitializer : kind === 'WithInitializerExpression' ? this.memberInitializer : this.expression;
    return this.n(kind, ...this.braceList(element));
  },
  /** `Name = value` or `[key] = value`, where the value may itself be an initializer; anything else is an expression. */
  memberInitializer() {
    let target;
    if (this.at('[')) target = this.indexInitializerTarget();
    else if (this.isId() && this.peek().kind === '=') target = this.n('IdentifierName', this.id());
    else return this.expression();
    const equals = this.expect('='),
      value = this.at('{') ? this.objectOrCollectionInitializer() : this.expression();
    return this.n('SimpleAssignmentExpression', target, equals, value);
  },
  /**
   * The initializer after an object creation or a member name. As in Roslyn it is an object initializer when it is
   * empty or any element is a member or index assignment, and a collection initializer otherwise.
   */
  objectOrCollectionInitializer() {
    const start = this.current;
    let assignments = 0,
      elements = 0;
    const parts = this.braceList(() => {
      elements++;
      if (this.at('{')) return this.initializerExpression('ComplexElementInitializerExpression');
      if (this.at('[') || (this.isId() && this.peek().kind === '=')) assignments++;
      return this.memberInitializer();
    });
    const object = elements === 0 || assignments > 0;
    this.feature(object ? 'ObjectInitializer' : 'CollectionInitializer', start);
    return this.n(object ? 'ObjectInitializerExpression' : 'CollectionInitializerExpression', ...parts);
  }
};
