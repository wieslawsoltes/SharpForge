/**
 * Property declarations in full: accessor lists with bodies, bodiless accessors of abstract, extern and auto
 * properties, C# 2 accessor-level accessibility (`get; protected set;`), C# 6 expression bodies and initializers.
 * Indexers share the accessor list (see operators.js); the accessors themselves are parsed in accessors.js.
 */
export const propertyMethods = {
  propertyDeclaration(attributeLists, modifiers, type, explicit, identifier) {
    const bodies = this.accessorBodies,
      nameToken = this.memberName,
      accessors = this.at('{') ? this.inPropertyAccessors(this.accessorList) : null,
      tail = this.i,
      [expressionBody, initializer, semicolon] = this.at('=>') ? this.inPropertyAccessors(this.propertyTail) : this.propertyTail();
    this.accessorMemberForm(nameToken, bodies, expressionBody ? tail + 1 : -1);
    if (initializer) this.structFieldInitializer(nameToken);
    return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, accessors, expressionBody, initializer, semicolon);
  }
};
