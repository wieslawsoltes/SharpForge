import { declarationModifiers } from '../modifiers.js';
/** Type members: nested types, fields, methods, properties and their parameter lists, bodies and accessors. */
const memberStarts = ['[', 'class', 'struct', 'interface', 'enum', 'delegate', 'event', '~', 'implicit', 'explicit', 'const', '(', 'fixed'];
const accessorKinds = { get: 'GetAccessorDeclaration', set: 'SetAccessorDeclaration', init: 'InitAccessorDeclaration', add: 'AddAccessorDeclaration', remove: 'RemoveAccessorDeclaration' };
export const memberMethods = {
  canStartMember(token = this.current) { return memberStarts.includes(token.kind) || declarationModifiers.has(token.kind) || this.isPredefined(token) || this.isId(token); },
  /** Any member of a class, struct or interface, including nested type declarations. `owner` is the enclosing type name. */
  memberDeclaration(owner) {
    const attributeLists = this.attributeLists(), modifiers = this.modifiers();
    return this.typeLikeDeclaration(attributeLists, modifiers) ?? this.memberDeclarationAfterModifiers(attributeLists, modifiers, owner);
  },
  memberDeclarationAfterModifiers(attributeLists, modifiers, owner) {
    if (this.at('event')) return this.eventDeclaration(attributeLists, modifiers);
    if (this.at('~')) return this.destructorDeclaration(attributeLists, modifiers);
    if (this.atAny(['implicit', 'explicit'])) return this.conversionOperatorDeclaration(attributeLists, modifiers);
    if (this.at('fixed')) { modifiers.push(this.take()); this.feature('FixedBuffer', this.tokens[this.i - 1]); }
    if (this.isId() && this.peek().kind === '(' && !modifiers.some(m => m.kind === 'ConstKeyword')) return this.constructorDeclaration(attributeLists, modifiers, owner);
    if (!this.isId() && !this.isPredefined() && !this.atAny(['(', 'ref', 'delegate'])) {
      this.error(this.current, 'CS1519', `Invalid token '${this.current.text}' in class, record, struct, or interface member declaration`);
      return this.n('IncompleteMember', attributeLists, modifiers, null);
    }
    const type = this.type(), explicit = this.explicitInterfaceSpecifier();
    if (this.at('operator')) return this.operatorDeclaration(attributeLists, modifiers, type, explicit);
    if (this.at('this')) return this.indexerDeclaration(attributeLists, modifiers, type, explicit);
    if (!this.isId()) {
      this.error(this.current, 'CS1519', `Invalid token '${this.current.text}' in class, record, struct, or interface member declaration`);
      return explicit ? this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, this.cache.missing('IdentifierToken'), null, null, null, null) : this.n('IncompleteMember', attributeLists, modifiers, type);
    }
    const identifier = this.id();
    if (this.at('(') || this.at('<')) return this.methodDeclaration(attributeLists, modifiers, type, explicit, identifier);
    if (this.at('{') || this.at('=>')) return this.propertyDeclaration(attributeLists, modifiers, type, explicit, identifier);
    if (explicit) { this.error(this.current, 'CS1514', '{ expected'); return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, null, null, null, this.match(';')); }
    return this.n('FieldDeclaration', attributeLists, modifiers, this.n('VariableDeclaration', type, this.variableDeclarators(identifier)), this.expect(';'));
  },
  /** Declarators of a field or local: `a = 1, b, c[10]`. `first` is an already consumed identifier. */
  variableDeclarators(first) {
    const list = [];
    for (let identifier = first ?? this.id(); ; identifier = this.id()) {
      const argumentList = this.at('[') ? this.bracketedArgumentList() : null;
      list.push(this.n('VariableDeclarator', identifier, argumentList, this.at('=') ? this.n('EqualsValueClause', this.take(), this.variableInitializer()) : null));
      if (this.at(',')) list.push(this.take()); else return list;
    }
  },
  variableInitializer() { return this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : this.expression(); },
  methodDeclaration(attributeLists, modifiers, returnType, explicit, identifier) {
    const typeParameters = this.at('<') ? this.typeParameterList() : null, parameters = this.parameterList(), constraints = this.constraintClauses();
    const [body, expressionBody, semicolon] = this.asyncBody(modifiers, () => this.functionBody('ExpressionBodiedMethod'));
    return this.n('MethodDeclaration', attributeLists, modifiers, returnType, explicit, identifier, typeParameters, parameters, constraints, body, expressionBody, semicolon);
  },
  /** Runs `parse` with the async context implied by `modifiers` (true when they include `async`). */
  asyncBody(modifiers, parse) { const saved = this.inAsync; this.inAsync = modifiers.some(m => m.kind === 'AsyncKeyword'); try { return parse(); } finally { this.inAsync = saved; } },
  /** A block body, an expression body (`=> e;`) or a bare semicolon: returns [body, expressionBody, semicolonToken]. */
  functionBody(feature) {
    if (this.at('{')) return [this.block(), null, this.match(';')];
    if (this.at('=>')) { if (feature) this.feature(feature, this.current); const arrow = this.take(); return [null, this.n('ArrowExpressionClause', arrow, this.expressionOrRef()), this.expect(';')]; }
    return [null, null, this.expect(';')];
  },
  propertyDeclaration(attributeLists, modifiers, type, explicit, identifier) {
    let accessors = null, expressionBody = null, initializer = null, semicolon = null;
    if (this.at('{')) accessors = this.accessorList();
    if (this.at('=>')) { this.feature('ExpressionBodiedProperty', this.current); expressionBody = this.n('ArrowExpressionClause', this.take(), this.expressionOrRef()); semicolon = this.expect(';'); }
    else if (this.at('=')) { this.feature('AutoPropertyInitializer', this.current); initializer = this.n('EqualsValueClause', this.take(), this.variableInitializer()); semicolon = this.expect(';'); }
    else semicolon = this.match(';');
    return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, accessors, expressionBody, initializer, semicolon);
  },
  accessorList() {
    const open = this.take(), accessors = [];
    while (!this.at('}') && !this.at('eof')) {
      const before = this.i, attributeLists = this.attributeLists(), modifiers = this.modifiers(), token = this.current, word = this.isId(token) && !token.flags ? token.value : null;
      let kind = accessorKinds[word], keyword;
      if (kind) { keyword = this.takeWord(word); if (word === 'init') this.feature('InitOnlySetters', token); if (modifiers.length) this.feature('PropertyAccessorMods', token); }
      else { this.error(token, 'CS1014', 'A get or set accessor expected'); kind = 'UnknownAccessorDeclaration'; if (this.isId(token)) keyword = this.take(); else { if (!attributeLists.length && !modifiers.length) { this.skip(); continue; } keyword = this.cache.missing('IdentifierToken'); } }
      const [body, expressionBody, semicolon] = this.at('{') || this.at('=>') || this.at(';') ? this.functionBody('ExpressionBodiedAccessor') : [null, null, this.expect(';')];
      accessors.push(this.n(kind, attributeLists, modifiers, keyword, body, expressionBody, semicolon)); this.guardProgress(before);
    }
    return this.n('AccessorList', open, accessors, this.expect('}'));
  },
  parameterList() { const open = this.expect('('), parameters = this.parameters(')'); return this.n('ParameterList', open, parameters, this.expect(')')); },
  bracketedParameterList() { const open = this.expect('['), parameters = this.parameters(']'); return this.n('BracketedParameterList', open, parameters, this.expect(']')); },
  parameters(close) {
    const list = [];
    while (!this.at(close) && !this.at('eof')) {
      const before = this.i; list.push(this.parameter());
      if (this.at(',')) list.push(this.take()); else break; if (before === this.i) break;
    }
    return list;
  },
  parameter() {
    const attributeLists = this.attributeLists(), modifiers = this.parameterModifiers();
    if (this.at('__arglist')) return this.n('Parameter', attributeLists, modifiers, null, this.take(), null);
    const type = this.type(), identifier = this.id();
    if (this.at('=')) this.feature('OptionalParameter', this.current);
    return this.n('Parameter', attributeLists, modifiers, type, identifier, this.at('=') ? this.n('EqualsValueClause', this.take(), this.expression()) : null);
  }
};
