/**
 * C# 6 forms that hook into older grammar: `using static T;`, exception filters (`catch (E e) when (condition)`) and
 * index initializers (`[key] = value` in an object initializer). Each records its catalog feature for the gate.
 */
export const csharp6Methods = {
  /** The optional `static` of a using directive. */
  usingStaticKeyword() {
    if (!this.at('static')) return null;
    this.feature('UsingStatic', this.current);
    return this.take();
  },
  /** `when (condition)` after a catch declaration; the caller has checked that the cursor is at the word `when`. */
  catchFilter() {
    this.feature('ExceptionFilter', this.current);
    const keyword = this.takeWord('when'),
      open = this.expect('('),
      condition = this.expression();
    return this.n('CatchFilterClause', keyword, open, condition, this.expect(')'));
  },
  /** The `[key]` target of an index initializer; the caller has checked that the cursor is at `[`. */
  indexInitializerTarget() {
    this.feature('DictionaryInitializer', this.current);
    return this.n('ImplicitElementAccess', this.bracketedArgumentList());
  }
};
