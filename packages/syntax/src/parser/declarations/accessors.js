/**
 * Accessor lists of properties, indexers and events: `get`, `set`, C# 9 `init`, `add` and `remove`, each with optional
 * attributes, modifiers (C# 2 accessor accessibility, C# 8 `readonly`) and a block, expression or semicolon body; plus
 * the C# 11 `required` member modifier. `init` and `required` are contextual: they stay identifiers anywhere else.
 */
const accessorKinds = {
  get: 'GetAccessorDeclaration',
  set: 'SetAccessorDeclaration',
  init: 'InitAccessorDeclaration',
  add: 'AddAccessorDeclaration',
  remove: 'RemoveAccessorDeclaration'
};
export const accessorMethods = {
  accessorList() {
    const open = this.take(),
      accessors = [];
    while (!this.at('}') && !this.at('eof')) {
      const before = this.i,
        attributeLists = this.attributeLists(),
        modifiers = this.modifiers(),
        token = this.current,
        word = this.isId(token) && !token.flags ? token.value : null;
      let kind = Object.hasOwn(accessorKinds, word ?? '') ? accessorKinds[word] : undefined,
        keyword;
      if (kind) {
        keyword = this.takeWord(word);
        if (word === 'init') this.feature('InitOnlySetters', token);
        if (modifiers.length) this.feature('PropertyAccessorMods', token);
      } else {
        this.error(token, 'CS1014', 'A get or set accessor expected');
        kind = 'UnknownAccessorDeclaration';
        if (this.isId(token)) keyword = this.take();
        else {
          if (!attributeLists.length && !modifiers.length) {
            this.skip();
            continue;
          }
          keyword = this.cache.missing('IdentifierToken');
        }
      }
      const [body, expressionBody, semicolon] =
        this.at('{') || this.at('=>') || this.at(';') ? this.functionBody('ExpressionBodiedAccessor') : [null, null, this.expect(';')];
      accessors.push(this.n(kind, attributeLists, modifiers, keyword, body, expressionBody, semicolon));
      this.guardProgress(before);
    }
    return this.n('AccessorList', open, accessors, this.expect('}'));
  },
  /** `required` is a modifier when a member declaration can follow it: another modifier, a type keyword or a type name. */
  isRequiredModifier(index) {
    const token = this.tokens[index],
      next = this.tokens[Math.min(index + 1, this.tokens.length - 1)];
    return this.isWord(token, 'required') && this.canFollowContextualModifier(next);
  }
};
