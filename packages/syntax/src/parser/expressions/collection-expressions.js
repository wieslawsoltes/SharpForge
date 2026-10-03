/**
 * C# 12 collection expressions: `[a, b, ..rest]` with expression and spread elements, and the C# 15 preview
 * `with(...)` element (see collection-arguments.js). A `[` in an expression is ambiguous in three places, each
 * resolved before this module is reached:
 *   - after an operand it is an element access (`a[0]`) or, after `?`, a conditional access (conditional-access.js);
 *   - `(T)[...]` is a cast of a collection expression when T can only be a type (`(int[])[1]`) or is generic
 *     (`(List<int>)[1]`), and an element access of a parenthesised expression otherwise (`(a)[1]`);
 *   - at the start of a statement or lambda it is an attribute list when a declaration or lambda follows the
 *     closing bracket (attributes.js, lambdas.js).
 */
export const collectionExpressionMethods = {
  /** After the type of a possible cast `(T)`: whether `[` starts a collection expression being cast. `info` is the type scan result. */
  isCollectionCast(info) {
    return !!info.generic;
  },
  collectionExpression() {
    const start = this.current,
      open = this.take(),
      elements = [];
    this.feature('CollectionExpressions', start);
    this.nested(() => {
      while (!this.at(']') && !this.at('eof')) {
        // After a comma the list goes on only with another element (or another comma, which reports the missing one).
        if (elements.length && !this.at(',') && !this.canStartCollectionElement()) break;
        const before = this.i;
        elements.push(this.collectionElement(elements.length === 0));
        const comma = this.separator(this.canStartCollectionElement);
        if (!comma || before === this.i) break;
        elements.push(comma);
      }
    });
    return this.n('CollectionExpression', open, elements, this.expect(']'));
  },
  canStartCollectionElement() {
    return this.at('..') || this.canStartExpression();
  },
  /** A spread (`..e`), the preview `with(...)` element (first position only) or an expression. */
  collectionElement(first) {
    if (this.at('..')) return this.n('SpreadElement', this.take(), this.expression());
    if (first && this.isCollectionArguments()) return this.collectionArguments();
    return this.n('ExpressionElement', this.expression());
  }
};
