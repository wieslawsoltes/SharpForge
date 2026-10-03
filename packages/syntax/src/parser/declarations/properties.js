/**
 * Property declarations in full: accessor lists with bodies, bodiless accessors of abstract, extern and auto
 * properties, C# 2 accessor-level accessibility (`get; protected set;`), C# 6 expression bodies and initializers.
 * Indexers share the accessor list (see operators.js); the accessors themselves are parsed in accessors.js.
 */
export const propertyMethods = {
  propertyDeclaration(attributeLists, modifiers, type, explicit, identifier) {
    const accessors = this.at('{') ? this.accessorList() : null,
      [expressionBody, initializer, semicolon] = this.propertyTail();
    return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, accessors, expressionBody, initializer, semicolon);
  }
};
