/** Instance and static constructors with this()/base() initialisers, and destructors. Constants and multi-declarator fields share variableDeclarators(). */
export const constructorMethods = {
  constructorDeclaration(attributeLists, modifiers, owner) {
    const nameToken = this.current,
      identifier = this.id();
    // Below C# 14 `extension(T x) { }` is a constructor to Roslyn's parser too, and Roslyn reports the whole declaration
    // as a use of extension blocks (CS9260) instead of a method without a return type.
    const misnamed = owner !== null && owner !== undefined && nameToken.value !== owner,
      extensionBlock = misnamed && this.isWord(nameToken, 'extension'),
      first = this.tokens[this.memberStart];
    if (misnamed && !extensionBlock) this.error(nameToken, 'CS1520', 'Method must have a return type');
    const parameters = this.parameterList();
    let initializer = null;
    if (this.at(':')) {
      const colon = this.take(),
        base = this.at('base');
      if (this.at('this') || base) {
        const keyword = this.take();
        initializer = this.n(base ? 'BaseConstructorInitializer' : 'ThisConstructorInitializer', colon, keyword, this.inInitializer(this.argumentList));
      } else {
        this.error(this.current, 'CS1018', "Keyword 'this' or 'base' expected");
        initializer = this.n('ThisConstructorInitializer', colon, this.missing('this'), this.argumentList());
      }
    }
    const [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedDeOrConstructor');
    if (extensionBlock) this.feature('Extensions', first, this.declarationEnd(semicolon ?? body));
    return this.n('ConstructorDeclaration', attributeLists, modifiers, identifier, parameters, initializer, body, expressionBody, semicolon);
  },
  /**
   * Where a declaration that ends with `last` (a green node or token) ends: after its last token, or, when that token
   * is missing, where Roslyn places the missing token (after the trivia that follows the token before it).
   */
  declarationEnd(last) {
    let token = last;
    while (token && !token.isToken) token = token.children.findLast(child => child);
    const previous = this.tokens[this.i - 1];
    return token?.isMissing ? (previous.trailingTrivia.at(-1)?.end ?? previous.end) : previous.end;
  },
  destructorDeclaration(attributeLists, modifiers) {
    const tilde = this.take(),
      identifier = this.id(),
      parameters = this.parameterList(),
      [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedDeOrConstructor');
    return this.n('DestructorDeclaration', attributeLists, modifiers, tilde, identifier, parameters, body, expressionBody, semicolon);
  }
};
