/**
 * C# 12 forms that hook into older grammar: a using alias for any type (`using P = (int x, int y);`,
 * `using unsafe X = int*;`) and lambda parameters with default values or `params`. Each is recorded where Roslyn
 * reports it.
 */
const nameKinds = new Set(['IdentifierName', 'QualifiedName', 'GenericName', 'AliasQualifiedName']);
export const csharp12Methods = {
  /** The optional `unsafe` of a using directive, which is itself the C# 12 feature. */
  usingUnsafeKeyword() {
    if (!this.at('unsafe')) return null;
    this.feature('UsingTypeAlias', this.current);
    return this.take();
  },
  /**
   * The target of `using Alias = ...`: any type. Before C# 12 only a namespace or named type was allowed, so a tuple,
   * array, pointer, nullable or predefined type is the feature, reported over the type.
   */
  usingAliasTarget(isUnsafe) {
    const start = this.current,
      type = this.type();
    // With `unsafe` the keyword has already been reported, and Roslyn reports nothing more for the type.
    if (!isUnsafe && !nameKinds.has(type.kind)) this.feature('UsingTypeAlias', start, this.tokens[this.i - 1]);
    return type;
  },
  /** Records what a lambda parameter uses: `params` among its modifier tokens [from, to) and a default value at `equals`. */
  lambdaParameterFeatures(from, to, equals) {
    for (let i = from; i < to; i++) if (this.tokens[i].kind === 'params') this.feature('LambdaParamsArray', this.tokens[i]);
    if (equals) this.feature('LambdaOptionalParameters', equals);
  }
};
