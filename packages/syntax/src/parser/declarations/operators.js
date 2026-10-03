import { overloadableOperators } from '../../lexer/operators.js';
/** Indexers (`this[...]`), unary/binary operator declarations, true/false operators and implicit/explicit conversions. */
export const operatorMethods = {
  indexerDeclaration(attributeLists, modifiers, type, explicit) {
    const keyword = this.take(), parameters = this.bracketedParameterList(); let accessors = null, expressionBody = null, semicolon = null;
    if (this.at('=>')) { this.feature('ExpressionBodiedIndexer', this.current); expressionBody = this.n('ArrowExpressionClause', this.take(), this.expressionOrRef()); semicolon = this.expect(';'); }
    else if (this.at('{')) { accessors = this.accessorList(); semicolon = this.match(';'); }
    else this.error(this.current, 'CS1514', '{ expected');
    return this.n('IndexerDeclaration', attributeLists, modifiers, type, explicit, keyword, parameters, accessors, expressionBody, semicolon);
  },
  operatorDeclaration(attributeLists, modifiers, returnType, explicit) {
    const keyword = this.take(), checkedKeyword = this.at('checked') ? this.take() : null, operator = this.operatorAt(), start = this.current; let token;
    if (checkedKeyword) this.feature('CheckedUserDefinedOperators', this.tokens[this.i - 1]);
    if (overloadableOperators.has(operator.text)) { token = this.takeOperator(operator); if (operator.text === '>>>') this.feature('UnsignedRightShift', start); else if (/^(?:[-+*\/%&|^]|<<|>>>?)=$/.test(operator.text)) this.feature('UserDefinedCompoundAssignmentOperators', start); }
    else {
      this.error(start, 'CS1019', 'Overloadable unary operator expected');
      token = this.at('(') || this.at('eof') ? this.cache.missing('PlusToken') : this.take();
    }
    const parameters = this.parameterList(), [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedMethod');
    return this.n('OperatorDeclaration', attributeLists, modifiers, returnType, explicit, keyword, checkedKeyword, token, parameters, body, expressionBody, semicolon);
  },
  conversionOperatorDeclaration(attributeLists, modifiers) {
    const direction = this.take(), explicit = this.at('operator') ? null : this.explicitInterfaceSpecifier(), keyword = this.expect('operator'), checkedKeyword = this.at('checked') ? this.take() : null;
    if (checkedKeyword) this.feature('CheckedUserDefinedOperators', this.tokens[this.i - 1]);
    const type = this.type(), parameters = this.parameterList(), [body, expressionBody, semicolon] = this.functionBody('ExpressionBodiedMethod');
    return this.n('ConversionOperatorDeclaration', attributeLists, modifiers, direction, explicit, keyword, checkedKeyword, type, parameters, body, expressionBody, semicolon);
  }
};
