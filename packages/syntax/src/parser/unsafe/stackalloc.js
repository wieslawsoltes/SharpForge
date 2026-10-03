/**
 * `stackalloc` expressions: `stackalloc T[n]` (C# 1), with an initializer (C# 7.3) and the implicitly typed
 * `stackalloc[] { ... }` form (C# 7.3). Whether a nested position is allowed is a binder rule (C# 8).
 */
export const stackAllocMethods = {
  stackAllocExpression() {
    const keywordToken = this.current,
      keyword = this.take();
    if (this.at('[') && this.peek().kind === ']') {
      this.feature('StackAllocInitializer', keywordToken);
      return this.n(
        'ImplicitStackAllocArrayCreationExpression',
        keyword,
        this.take(),
        this.take(),
        this.initializerExpression('ArrayInitializerExpression')
      );
    }
    const type = this.type('new');
    if (this.at('{')) this.feature('StackAllocInitializer', keywordToken);
    return this.n('StackAllocArrayCreationExpression', keyword, type, this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : null);
  }
};
