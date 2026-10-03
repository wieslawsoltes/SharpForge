/** C# 9 `with` expressions: `point with { X = 1, Y = 2 }`. `with` is an identifier unless an initializer brace follows an expression. */
export const withMethods = {
  isWithExpression() {
    return this.atWord('with') && this.peek().kind === '{';
  },
  withExpression(receiver) {
    const start = this.current;
    this.feature('Records', start);
    this.precedenceInversion(receiver, start);
    return this.n('WithExpression', receiver, this.takeWord('with'), this.initializerExpression('WithInitializerExpression'));
  }
};
