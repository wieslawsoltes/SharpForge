/** Delegate declarations at namespace level and nested in types, including generic parameters and constraints. */
export const delegateMethods = {
  delegateDeclaration(attributeLists, modifiers) {
    const keyword = this.take(), returnType = this.type(), identifier = this.id(), typeParameters = this.at('<') ? this.typeParameterList() : null;
    const parameters = this.parameterList(), constraints = this.constraintClauses();
    return this.n('DelegateDeclaration', attributeLists, modifiers, keyword, returnType, identifier, typeParameters, parameters, constraints, this.expect(';'));
  }
};
