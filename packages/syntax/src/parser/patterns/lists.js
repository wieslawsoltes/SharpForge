import { Precedence } from '../../lexer/operators.js';
/** C# 11 list patterns `[p1, .., pn]`, slice patterns with an optional sub-pattern (`.. var rest`) and a trailing designation. */
export const listPatternMethods = {
  /** `..` with an optional sub-pattern; the cursor is at `..`. */
  slicePattern() {
    const dots = this.take(),
      hasPattern = !this.at(',') && !this.at(']') && this.canStartPattern(this.current);
    return this.n('SlicePattern', dots, hasPattern ? this.pattern(false, Precedence.Conditional) : null);
  },
  listPattern() {
    const start = this.current,
      open = this.take(),
      list = [],
      when = this.patternWhen;
    this.nested(() => {
      while (!this.at(']') && !this.at('eof')) {
        const before = this.i;
        list.push(this.at('..') ? this.slicePattern() : this.pattern(false, Precedence.Conditional));
        if (this.at(',')) list.push(this.take());
        else break;
        if (before === this.i) break;
      }
    });
    this.patternWhen = when;
    const close = this.expect(']');
    this.feature('ListPattern', start, this.tokens[this.i - 1]);
    return this.n('ListPattern', open, list, close, this.isDesignationAhead() ? this.designation() : null);
  }
};
