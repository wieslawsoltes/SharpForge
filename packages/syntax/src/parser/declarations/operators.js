import { overloadableOperators } from '../../lexer/operators.js';
const unaryOperators = new Set(['+', '-', '!', '~', '++', '--', 'true', 'false']);
const binaryOperators = new Set(['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>', '==', '!=', '>', '<', '>=', '<=']);
const compoundOrInstance = /=$/;
/** Indexers (`this[...]`), unary/binary operator declarations, true/false operators and implicit/explicit conversions. */
export const operatorMethods = {
  indexerDeclaration(attributeLists, modifiers, type, explicit) {
    const keyword = this.take(),
      parameters = this.bracketedParameterList(),
      bodies = this.accessorBodies,
      nameToken = this.memberName;
    // Roslyn keeps an accessor list and an expression body when both are written (the binder reports CS8056).
    if (!this.at('{') && !this.at('=>')) this.error(this.current, 'CS1514', '{ expected');
    const accessors = this.at('{') ? this.accessorList() : null,
      tail = this.i,
      expressionBody = this.at('=>') ? this.arrowExpressionClause('ExpressionBodiedIndexer') : null,
      semicolon = expressionBody ? this.expect(';') : accessors ? this.match(';') : null;
    this.accessorMemberForm(nameToken, bodies, expressionBody ? tail + 1 : -1);
    return this.n('IndexerDeclaration', attributeLists, modifiers, type, explicit, keyword, parameters, accessors, expressionBody, semicolon);
  },
  operatorDeclaration(attributeLists, modifiers, returnType, explicit) {
    const keyword = this.take(),
      checkedKeyword = this.checkedOperatorKeyword(),
      operator = this.operatorAt(),
      start = this.current;
    let token;
    this.memberForm(start, true);
    this.staticAbstractMember(start);
    if (overloadableOperators.has(operator.text)) {
      token = this.takeOperator(operator);
      this.operatorFeatures(operator.text, modifiers, start);
    } else {
      this.error(start, 'CS1019', 'Overloadable unary operator expected');
      token = this.at('(') || this.at('eof') ? this.cache.missing('PlusToken') : this.take();
    }
    const parameters = this.parameterList();
    if (!token.isMissing) this.operatorArity(operator.text, parameters, start);
    const [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedMethod');
    return this.n(
      'OperatorDeclaration',
      attributeLists,
      modifiers,
      returnType,
      explicit,
      keyword,
      checkedKeyword,
      token,
      parameters,
      body,
      expressionBody,
      semicolon
    );
  },
  /**
   * Roslyn checks the operator against the number of parameters while parsing: one parameter needs a unary operator
   * (CS1019) and two a binary one (CS1020). Compound assignment and instance increment operators are left to the binder.
   */
  operatorArity(text, parameters, token) {
    if (compoundOrInstance.test(text)) return;
    let count = 0;
    for (const child of parameters.children[1]?.children ?? []) if (child.kind === 'Parameter') count++;
    if (count === 1 && !unaryOperators.has(text)) this.error(token, 'CS1019', 'Overloadable unary operator expected');
    else if (count === 2 && !binaryOperators.has(text)) this.error(token, 'CS1020', 'Overloadable binary operator expected');
  },
  conversionOperatorDeclaration(attributeLists, modifiers) {
    const direction = this.take(),
      explicit = this.at('operator') ? null : this.explicitInterfaceSpecifier(),
      keyword = this.expect('operator'),
      checkedKeyword = this.checkedOperatorKeyword(),
      typeStart = this.current;
    this.staticAbstractMember(typeStart);
    const type = this.type(),
      parameters = this.parameterList(),
      [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedMethod');
    return this.n(
      'ConversionOperatorDeclaration',
      attributeLists,
      modifiers,
      direction,
      explicit,
      keyword,
      checkedKeyword,
      type,
      parameters,
      body,
      expressionBody,
      semicolon
    );
  }
};
