/** C# 10 record structs: the `struct` (or explicit `class`) keyword after `record`, as in `readonly record struct P(int X, int Y);`. */
export const recordStructMethods = {
  /** Consumes `class` or `struct` after `record`; both spellings need C# 10, as in Roslyn. Returns the keyword or null. */
  recordModifier() {
    if (!this.at('class') && !this.at('struct')) return null;
    this.feature('RecordStructs', this.current);
    return this.take();
  }
};
