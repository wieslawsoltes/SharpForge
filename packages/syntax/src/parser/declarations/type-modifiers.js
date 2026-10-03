/**
 * Modifiers on type declarations and the language features they imply: C# 2 static classes and partial types of every
 * kind (class, struct, interface, record), C# 7.2 ref and readonly structs.
 */
export const typeModifierMethods = {
  /** Records the features used by `modifiers` on a type of `kind` (a declaration node kind); `token` is the type keyword. */
  typeModifierFeatures(modifiers, kind, token, keywordIndex) {
    const isStruct = kind === 'StructDeclaration' || kind === 'RecordStructDeclaration';
    for (let index = 0; index < modifiers.length; index++) {
      const modifier = modifiers[index];
      const feature =
        modifier.kind === 'PartialKeyword'
          ? 'PartialTypes'
          : modifier.kind === 'StaticKeyword' && kind === 'ClassDeclaration'
            ? 'StaticClasses'
            : modifier.kind === 'RefKeyword'
              ? 'RefStructs'
              : modifier.kind === 'ReadOnlyKeyword' && isStruct
                ? 'ReadOnlyStructs'
                : null;
      if (feature) {
        // Green modifiers have no positions; retain the original lexer token's UTF-16 span.
        const anchor = feature === 'RefStructs' || feature === 'ReadOnlyStructs'
          ? this.tokens[keywordIndex - modifiers.length + index] : token;
        this.feature(feature, anchor);
      }
    }
  }
};
