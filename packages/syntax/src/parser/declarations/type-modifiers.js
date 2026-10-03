/**
 * Modifiers on type declarations and the language features they imply: C# 2 static classes and partial types of every
 * kind (class, struct, interface, record). The C# 7.2 struct modifiers are classified in struct-modifiers.js.
 */
export const typeModifierMethods = {
  /**
   * Records the features used by `modifiers` on a type of `kind` (a declaration node kind), each at its own modifier
   * as Roslyn does. `keyword` is the lexer token of the type keyword, which the modifiers immediately precede.
   */
  typeModifierFeatures(modifiers, kind, keyword) {
    if (!modifiers.length) return;
    let index = this.i;
    while (index > 0 && this.tokens[index] !== keyword) index--;
    const first = index - modifiers.length;
    for (let k = 0; k < modifiers.length; k++) {
      const modifier = modifiers[k],
        feature =
          modifier.kind === 'PartialKeyword'
            ? 'PartialTypes'
            : modifier.kind === 'StaticKeyword' && kind === 'ClassDeclaration'
              ? 'StaticClasses'
              : this.structModifierFeature(modifier, kind);
      if (feature) this.feature(feature, this.tokens[first + k]);
    }
  }
};
