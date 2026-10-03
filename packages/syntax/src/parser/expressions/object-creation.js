/**
 * `new` expressions: object creation with arguments and initializers, C# 9 target-typed `new()`, C# 3 anonymous
 * objects and implicitly typed arrays, and array creation with sizes, rank specifiers and initializers (`new T[n, m]`,
 * `new T[n][]`, `new[] { ... }`).
 */
export const objectCreationMethods = {
  newExpression() {
    const start = this.current,
      keyword = this.take();
    if (this.at('(') && !(this.scanTupleType(this.i) >= 0 && ['[', '?'].includes(this.kindAt(this.scanTupleType(this.i))))) {
      this.feature('ImplicitObjectCreation', start);
      return this.n('ImplicitObjectCreationExpression', keyword, this.argumentList(), this.at('{') ? this.objectOrCollectionInitializer() : null);
    }
    if (this.at('{')) {
      this.feature('AnonymousTypes', start);
      const open = this.take(),
        list = [];
      this.nested(() => {
        while (!this.at('}') && !this.at('eof')) {
          const before = this.i,
            nameEquals = this.isId() && this.peek().kind === '=' ? this.n('NameEquals', this.n('IdentifierName', this.id()), this.take()) : null;
          list.push(this.n('AnonymousObjectMemberDeclarator', nameEquals, this.expression()));
          if (this.at(',')) list.push(this.take());
          else break;
          if (before === this.i) break;
        }
      });
      return this.n('AnonymousObjectCreationExpression', keyword, open, list, this.expect('}'));
    }
    if (this.at('[')) {
      this.feature('ImplicitArray', start);
      const open = this.take(),
        commas = [];
      while (this.at(',')) commas.push(this.take());
      const close = this.expect(']');
      return this.n(
        'ImplicitArrayCreationExpression',
        keyword,
        open,
        commas,
        close,
        this.at('{')
          ? this.initializerExpression('ArrayInitializerExpression')
          : this.n('ArrayInitializerExpression', this.expect('{'), null, this.cache.missing('CloseBraceToken'))
      );
    }
    const type = this.type('new');
    if (type.kind === 'ArrayType')
      return this.n('ArrayCreationExpression', keyword, type, this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : null);
    const args = this.at('(') ? this.argumentList() : null,
      initializer = this.at('{') ? this.objectOrCollectionInitializer() : null;
    if (!args && !initializer) this.error(this.current, 'CS1526', 'A new expression requires an argument list or (), [], or {} after type');
    return this.n('ObjectCreationExpression', keyword, type, args, initializer);
  }
};
