/**
 * Property declarations in full: accessor lists with bodies, bodiless accessors of abstract, extern and auto
 * properties, C# 2 accessor-level accessibility (`get; protected set;`), C# 6 expression bodies and initializers.
 * Indexers share the accessor list (see operators.js); the accessors themselves are parsed in accessors.js.
 */
export const propertyMethods = {
  propertyDeclaration(attributeLists, modifiers, type, explicit, identifier) {
    let accessors = null,
      expressionBody = null,
      initializer = null,
      semicolon = null;
    if (this.at('{')) accessors = this.accessorList();
    if (this.at('=>')) {
      this.feature('ExpressionBodiedProperty', this.current);
      expressionBody = this.n('ArrowExpressionClause', this.take(), this.expressionOrRef());
      semicolon = this.expect(';');
    } else if (this.at('=')) {
      this.feature('AutoPropertyInitializer', this.current);
      initializer = this.n('EqualsValueClause', this.take(), this.variableInitializer());
      semicolon = this.expect(';');
    } else semicolon = this.match(';');
    return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, accessors, expressionBody, initializer, semicolon);
  }
};
