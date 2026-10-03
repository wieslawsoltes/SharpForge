/** C# 8 switch expressions: `value switch { pattern when guard => result, ... }`. */
export const switchExpressionMethods = {
  switchExpression(governing) {
    const start = this.current,
      keyword = this.take(),
      open = this.expect('{'),
      arms = [];
    this.feature('SwitchExpression', start);
    this.nested(() => {
      while (!this.at('}') && !this.at('eof')) {
        const before = this.i,
          pattern = this.pattern(true),
          when = this.atWord('when') ? this.n('WhenClause', this.takeWord('when'), this.expression()) : null;
        arms.push(this.n('SwitchExpressionArm', pattern, when, this.expect('=>'), this.expression()));
        if (this.at(',')) arms.push(this.take());
        else break;
        if (before === this.i) break;
      }
    });
    return this.n('SwitchExpression', governing, keyword, open, arms, this.expect('}'));
  }
};
