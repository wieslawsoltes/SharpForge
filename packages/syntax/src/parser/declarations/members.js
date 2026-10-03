import { declarationModifiers } from '../modifiers.js';
/** Type members: nested types, fields, methods, properties and their parameter lists, bodies and accessors. */
const memberStarts = ['[', 'class', 'struct', 'interface', 'enum', 'delegate', 'event', '~', 'implicit', 'explicit', 'const', '(', 'fixed'];
export const memberMethods = {
  canStartMember(token = this.current) {
    return memberStarts.includes(token.kind) || declarationModifiers.has(token.kind) || this.isPredefined(token) || this.isId(token);
  },
  /** Any member of a class, struct or interface, including nested type declarations. `owner` is the enclosing type name. */
  memberDeclaration(owner) {
    const attributeLists = this.attributeLists(),
      modifiers = this.modifiers();
    return this.typeLikeDeclaration(attributeLists, modifiers) ?? this.memberDeclarationAfterModifiers(attributeLists, modifiers, owner);
  },
  memberDeclarationAfterModifiers(attributeLists, modifiers, owner) {
    this.closedModifier(modifiers, 'member');
    if (this.at('event')) {
      this.partialMember(modifiers, 'EventDeclaration', this.current);
      return this.eventDeclaration(attributeLists, modifiers);
    }
    if (this.at('~')) return this.destructorDeclaration(attributeLists, modifiers);
    if (this.atAny(['implicit', 'explicit'])) return this.conversionOperatorDeclaration(attributeLists, modifiers);
    if (this.at('fixed')) {
      modifiers.push(this.take());
      this.feature('FixedBuffer', this.tokens[this.i - 1]);
    }
    if (this.isId() && this.peek().kind === '(' && !modifiers.some(m => m.kind === 'ConstKeyword')) {
      this.partialMember(modifiers, 'ConstructorDeclaration', this.current);
      return this.constructorDeclaration(attributeLists, modifiers, owner);
    }
    if (!this.isId() && !this.isPredefined() && !this.atAny(['(', 'ref', 'delegate'])) {
      this.error(this.current, 'CS1519', `Invalid token '${this.current.text}' in class, record, struct, or interface member declaration`);
      return this.n('IncompleteMember', attributeLists, modifiers, null);
    }
    const typeStart = this.current,
      type = this.type(),
      explicit = this.explicitInterfaceSpecifier();
    if (type.kind === 'RefType') this.feature('RefLocalsReturns', typeStart);
    if (this.at('operator')) return this.operatorDeclaration(attributeLists, modifiers, type, explicit);
    if (this.at('this')) {
      this.partialMember(modifiers, 'IndexerDeclaration', this.current);
      this.extensionIndexer(this.current);
      return this.indexerDeclaration(attributeLists, modifiers, type, explicit);
    }
    if (!this.isId()) {
      this.error(this.current, 'CS1519', `Invalid token '${this.current.text}' in class, record, struct, or interface member declaration`);
      return explicit
        ? this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, this.cache.missing('IdentifierToken'), null, null, null, null)
        : this.n('IncompleteMember', attributeLists, modifiers, type);
    }
    const nameToken = this.current,
      identifier = this.id();
    if (this.at('(') || this.at('<')) {
      this.partialMember(modifiers, 'MethodDeclaration', nameToken, type);
      return this.methodDeclaration(attributeLists, modifiers, type, explicit, identifier);
    }
    if (this.at('{') || this.at('=>')) {
      this.partialMember(modifiers, 'PropertyDeclaration', nameToken);
      return this.propertyDeclaration(attributeLists, modifiers, type, explicit, identifier);
    }
    if (explicit) {
      this.error(this.current, 'CS1514', '{ expected');
      return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, null, null, null, this.match(';'));
    }
    return this.n(
      'FieldDeclaration',
      attributeLists,
      modifiers,
      this.n('VariableDeclaration', type, this.variableDeclarators(identifier)),
      this.expect(';')
    );
  },
  /** Declarators of a field or local: `a = 1, b, c[10]`. `first` is an already consumed identifier. */
  variableDeclarators(first) {
    const list = [];
    for (let identifier = first ?? this.id(); ; identifier = this.id()) {
      const argumentList = this.at('[') ? this.bracketedArgumentList() : null;
      list.push(
        this.n(
          'VariableDeclarator',
          identifier,
          argumentList,
          this.at('=') ? this.n('EqualsValueClause', this.take(), this.variableInitializer()) : null
        )
      );
      if (this.at(',')) list.push(this.take());
      else return list;
    }
  },
  variableInitializer() {
    return this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : this.expression();
  },
  methodDeclaration(attributeLists, modifiers, returnType, explicit, identifier) {
    const typeParameters = this.at('<') ? this.typeParameterList() : null,
      parameters = this.parameterList(),
      constraints = this.constraintClauses();
    const [body, expressionBody, semicolon] = this.asyncBody(modifiers, () => this.functionBody('ExpressionBodiedMethod'));
    return this.n(
      'MethodDeclaration',
      attributeLists,
      modifiers,
      returnType,
      explicit,
      identifier,
      typeParameters,
      parameters,
      constraints,
      body,
      expressionBody,
      semicolon
    );
  },
  /** Runs `parse` with the async context implied by `modifiers` (true when they include `async`). */
  asyncBody(modifiers, parse) {
    const saved = this.inAsync;
    this.inAsync = modifiers.some(m => m.kind === 'AsyncKeyword');
    try {
      return parse();
    } finally {
      this.inAsync = saved;
    }
  }
};
