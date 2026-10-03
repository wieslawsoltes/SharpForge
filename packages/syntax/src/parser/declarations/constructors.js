/** Instance and static constructors with this()/base() initialisers, and destructors. Constants and multi-declarator fields share variableDeclarators(). */
export const constructorMethods = {
  constructorDeclaration(attributeLists, modifiers, owner) {
    const nameToken = this.current, identifier = this.id();
    if (owner !== null && owner !== undefined && nameToken.value !== owner) this.error(nameToken, 'CS1520', 'Method must have a return type');
    const parameters = this.parameterList(); let initializer = null;
    if (this.at(':')) {
      const colon = this.take(), base = this.at('base');
      if (this.at('this') || base) { const keyword = this.take(); initializer = this.n(base ? 'BaseConstructorInitializer' : 'ThisConstructorInitializer', colon, keyword, this.argumentList()); }
      else { this.error(this.current, 'CS1018', "Keyword 'this' or 'base' expected"); initializer = this.n('ThisConstructorInitializer', colon, this.missing('this'), this.argumentList()); }
    }
    const [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedDeOrConstructor');
    return this.n('ConstructorDeclaration', attributeLists, modifiers, identifier, parameters, initializer, body, expressionBody, semicolon);
  },
  destructorDeclaration(attributeLists, modifiers) {
    const tilde = this.take(), identifier = this.id(), parameters = this.parameterList(), [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedDeOrConstructor');
    return this.n('DestructorDeclaration', attributeLists, modifiers, tilde, identifier, parameters, body, expressionBody, semicolon);
  }
};
