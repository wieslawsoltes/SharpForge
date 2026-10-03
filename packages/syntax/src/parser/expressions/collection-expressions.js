/**
 * C# 12 collection expressions: `[a, b, ..rest]` with expression and spread elements, and the C# 15 preview `with(...)`
 * argument element in first position.
 */
export const collectionExpressionMethods = {
  collectionExpression() {
    const start = this.current,
      open = this.take(),
      elements = [];
    this.feature('CollectionExpressions', start);
    this.nested(() => {
      while (!this.at(']') && !this.at('eof')) {
        const before = this.i;
        if (this.at('..')) elements.push(this.n('SpreadElement', this.take(), this.expression()));
        else if (this.atWord('with') && this.peek().kind === '(' && !elements.length) {
          this.feature('CollectionExpressionArguments', this.current);
          elements.push(this.n('WithElement', this.takeWord('with'), this.argumentList()));
        } else elements.push(this.n('ExpressionElement', this.expression()));
        if (this.at(',')) elements.push(this.take());
        else break;
        if (before === this.i) break;
      }
    });
    return this.n('CollectionExpression', open, elements, this.expect(']'));
  }
};
