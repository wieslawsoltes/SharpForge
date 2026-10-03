/**
 * C# 12 primary constructors: a parameter list on a class, struct or interface header, argument lists on base types
 * (`class D(int x) : B(x)`) and semicolon type bodies (`struct S(int y);`). Records share the base list.
 */
export const primaryConstructorMethods = {
  /** The parameter list of a type header, or null. `gated` is false for records, whose positional parameters are C# 9. */
  primaryConstructorParameters(gated = true) {
    if (!this.at('(')) return null;
    if (gated) this.feature('PrimaryConstructors', this.current);
    return this.parameterList();
  },
  /** `: Base(args), IOther` - a base type followed by an argument list is a PrimaryConstructorBaseType. */
  baseList() {
    const colon = this.take(),
      types = [];
    for (;;) {
      const before = this.i,
        type = this.type();
      types.push(this.at('(') ? this.n('PrimaryConstructorBaseType', type, this.argumentList()) : this.n('SimpleBaseType', type));
      if (this.at(',')) types.push(this.take());
      else break;
      if (before === this.i) break;
    }
    return this.n('BaseList', colon, types);
  }
};
