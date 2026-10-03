/**
 * C# 3 anonymous object creation (`new { A = 1, b.C }`) and implicitly typed arrays (`new[] { ... }`, `new[,] { ... }`).
 * Both follow the `new` keyword, which the caller has already consumed.
 */
export const anonymousObjectMethods = {
  anonymousObjectCreation(start, keyword) {
    this.feature('AnonymousTypes', start);
    const open = this.take(),
      members = [];
    this.nested(() => {
      while (!this.at('}') && !this.at('eof')) {
        const before = this.i;
        members.push(this.anonymousObjectMember());
        const comma = this.separator(this.canStartExpression);
        if (!comma || before === this.i) break;
        members.push(comma);
      }
    });
    return this.n('AnonymousObjectCreationExpression', keyword, open, members, this.expect('}'));
  },
  /** `Name = value`, or an expression whose last name becomes the member name (`b.C`). */
  anonymousObjectMember() {
    const named = this.isId() && this.peek().kind === '=',
      nameEquals = named ? this.n('NameEquals', this.n('IdentifierName', this.id()), this.take()) : null;
    return this.n('AnonymousObjectMemberDeclarator', nameEquals, this.expression());
  },
  implicitArrayCreation(start, keyword) {
    this.feature('ImplicitArray', start);
    const open = this.take(),
      commas = [];
    while (this.at(',')) commas.push(this.take());
    const close = this.expect(']');
    const initializer = this.at('{')
      ? this.initializerExpression('ArrayInitializerExpression')
      : this.n('ArrayInitializerExpression', this.expect('{'), null, this.cache.missing('CloseBraceToken'));
    return this.n('ImplicitArrayCreationExpression', keyword, open, commas, close, initializer);
  }
};
