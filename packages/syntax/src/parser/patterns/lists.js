/** C# 11 list patterns `[p1, .., pn]`, slice patterns with an optional sub-pattern (`.. var rest`) and a trailing designation. */
export const listPatternMethods = {
  listPattern() {
    const start = this.current,
      open = this.take(),
      list = [],
      when = this.patternWhen;
    this.feature('ListPattern', start);
    this.nested(() => {
      while (!this.at(']') && !this.at('eof')) {
        const before = this.i;
        if (this.at('..')) {
          const dots = this.take();
          list.push(this.n('SlicePattern', dots, !this.at(',') && !this.at(']') && this.canStartPattern(this.current) ? this.pattern(false) : null));
        } else list.push(this.pattern(false));
        if (this.at(',')) list.push(this.take());
        else break;
        if (before === this.i) break;
      }
    });
    this.patternWhen = when;
    const close = this.expect(']');
    return this.n('ListPattern', open, list, close, this.isDesignationAhead() ? this.designation() : null);
  }
};
