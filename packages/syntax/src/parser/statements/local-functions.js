/**
 * C# 7 local functions. A local declaration whose name is followed by `(` or `<` is a function, not a variable:
 * `int Add(int a, int b) { ... }`, `T Id<T>(T t) => t;`. Modifiers are `async` and `unsafe` (C# 7), `static` (C# 8)
 * and `extern` (C# 9); attributes are allowed from C# 9.
 */
const modifierFeatures = { static: 'StaticLocalFunctions', extern: 'ExternLocalFunctions' };
export const localFunctionMethods = {
  /** True when the token after a local's type and name starts a parameter or type-parameter list. */
  isLocalFunctionAhead() {
    return this.at('(') || this.at('<');
  },
  /**
   * The rest of a local function after its return type and name. `head` describes what was already consumed:
   * { attributeLists, modifiers, firstModifier (token index), type, identifier, start (first token) }.
   */
  localFunctionStatement(head) {
    this.feature('LocalFunctions', head.start);
    this.localFunctionFeatures(head);
    const typeParameters = this.at('<') ? this.typeParameterList() : null,
      parameters = this.parameterList(),
      constraints = this.constraintClauses(),
      [body, expressionBody, semicolon] = this.asyncBody(head.modifiers, () => this.functionBody());
    return this.n(
      'LocalFunctionStatement',
      head.attributeLists,
      head.modifiers,
      head.type,
      head.identifier,
      typeParameters,
      parameters,
      constraints,
      body,
      expressionBody,
      semicolon
    );
  },
  /** Records the later-version features a local function uses: static (8), extern (9) and attributes (9). */
  localFunctionFeatures(head) {
    for (let k = 0; k < head.modifiers.length; k++) {
      const token = this.tokens[head.firstModifier + k],
        feature = modifierFeatures[token.kind];
      if (feature) this.feature(feature, token);
    }
    if (head.attributeLists?.length) this.feature('LocalFunctionAttributes', this.tokens[this.statementStart], this.tokens[head.firstModifier - 1]);
  }
};
