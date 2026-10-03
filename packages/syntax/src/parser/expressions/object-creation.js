/**
 * `new` expressions: object creation with arguments and initializers, and array creation with sizes, rank
 * specifiers and initializers (`new T[n, m]`, `new T[n][]`). Anonymous objects and implicitly typed arrays are parsed
 * in anonymous-objects.js, the C# 9 target-typed `new()` in csharp9.js.
 */
export const objectCreationMethods = {
  newExpression() {
    const start = this.current,
      keyword = this.take();
    if (this.isImplicitObjectCreation()) return this.implicitObjectCreation(start, keyword);
    if (this.at('{')) return this.anonymousObjectCreation(start, keyword);
    if (this.at('[')) return this.implicitArrayCreation(start, keyword);
    const type = this.canStartNewType() ? this.type('new') : this.missingName();
    if (type.kind === 'ArrayType')
      return this.n('ArrayCreationExpression', keyword, type, this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : null);
    const args = this.at('(') ? this.argumentList() : this.at('{') ? null : this.missingArgumentList();
    return this.n('ObjectCreationExpression', keyword, type, args, this.at('{') ? this.objectOrCollectionInitializer() : null);
  },
  canStartNewType() {
    return this.isPredefined() || this.isId() || this.at('(') || (this.at('delegate') && this.peek().kind === '*');
  },
  /** `new T` with neither arguments nor an initializer: CS1526 and an argument list of two missing parentheses, as in Roslyn. */
  missingArgumentList() {
    this.error(this.errorAnchor(), 'CS1526', 'A new expression requires an argument list or (), [], or {} after type');
    return this.n('ArgumentList', this.missing('('), null, this.missing(')'));
  }
};
