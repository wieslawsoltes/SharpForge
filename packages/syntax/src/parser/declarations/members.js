import { declarationModifiers } from '../modifiers.js';
/** Type members: nested types, fields, methods, properties and their parameter lists, bodies and accessors. */
const memberStarts = ['[', 'class', 'struct', 'interface', 'enum', 'delegate', 'event', '~', 'implicit', 'explicit', 'const', '(', 'fixed'];
export const memberMethods = {
  canStartMember(token = this.current) {
    return memberStarts.includes(token.kind) || declarationModifiers.has(token.kind) || this.isPredefined(token) || this.isId(token);
  },
  /** Any member of a class, struct or interface, including nested type declarations. `owner` is the enclosing type name. */
  memberDeclaration(owner) {
    this.memberStart = this.i;
    this.memberErrors = this.diagnostics.length;
    const attributeLists = this.attributeLists();
    this.memberModifiers = this.i;
    const modifiers = this.modifiers();
    this.memberModifiersEnd = this.i;
    return this.typeLikeDeclaration(attributeLists, modifiers) ?? this.memberDeclarationAfterModifiers(attributeLists, modifiers, owner);
  },
  memberDeclarationAfterModifiers(attributeLists, modifiers, owner) {
    this.closedModifier(modifiers, 'member');
    if (modifiers.length) this.memberNameFeatures();
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
      this.memberForm(this.current, true);
      this.structConstructor();
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
      this.memberName = this.current;
      this.partialMember(modifiers, 'IndexerDeclaration', this.current);
      this.extensionIndexer(this.current);
      return this.indexerDeclaration(attributeLists, modifiers, type, explicit);
    }
    if (!this.isId()) {
      // An incomplete member that already carries an error (a missing type, say) reports nothing more, as in Roslyn.
      // Directly in a namespace Roslyn reports the type that stands alone instead (`x = 1;`, `Console.WriteLine();`).
      const clean = this.diagnostics.length === this.memberErrors;
      if (clean && !explicit && this.typeDepth === 0 && !this.options.backEndProfile) this.namespaceUnexpected(this.tokens[this.i - 1]);
      else if (explicit || clean) this.invalidMemberToken();
      return explicit
        ? this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, this.cache.missing('IdentifierToken'), null, null, null, null)
        : this.n('IncompleteMember', attributeLists, modifiers, type);
    }
    const nameToken = this.current,
      identifier = this.id();
    this.memberName = nameToken;
    if (this.at('(') || this.at('<')) {
      this.partialMember(modifiers, 'MethodDeclaration', nameToken, type);
      return this.methodDeclaration(attributeLists, modifiers, type, explicit, identifier);
    }
    if (this.at('{') || this.at('=>')) {
      this.partialMember(modifiers, 'PropertyDeclaration', nameToken);
      if (attributeLists.length) this.backingFieldAttributes(this.memberStart);
      return this.propertyDeclaration(attributeLists, modifiers, type, explicit, identifier);
    }
    if (explicit) {
      this.error(this.current, 'CS1514', '{ expected');
      return this.n('PropertyDeclaration', attributeLists, modifiers, type, explicit, identifier, null, null, null, this.match(';'));
    }
    if (this.inInterface()) this.memberForm(nameToken, true);
    if (this.at('=')) this.structFieldInitializer(nameToken);
    return this.n(
      'FieldDeclaration',
      attributeLists,
      modifiers,
      this.n('VariableDeclaration', type, this.fieldDeclarators(identifier)),
      this.expect(';')
    );
  },
  /** The declarators of a field, whose initializers are a restricted scope for expression variables (C# 7.3). */
  fieldDeclarators(first) {
    const saved = this.restrictedVariables;
    this.restrictedVariables = true;
    const declarators = this.variableDeclarators(first);
    this.restrictedVariables = saved;
    return declarators;
  },
  /**
   * Records the modifier features Roslyn reports at the member name. The name is found by lookahead because the
   * member kind is not known yet: after the type (and an explicit interface name) for most members, the name itself
   * for a constructor, and the first declarator of an event.
   */
  memberNameFeatures() {
    if (!this.hasNameReportedModifier()) return;
    let i = this.i;
    if (this.kindAt(i) === 'event') i++;
    const from = this.memberModifiers,
      to = this.memberModifiersEnd;
    if (this.isId(this.tokens[i]) && this.kindAt(i + 1) === '(') return this.modifierNameFeatures(from, to, this.tokens[i]);
    let end = this.scanType(i);
    if (end <= i) return;
    while (this.isId(this.tokens[end]) && (this.kindAt(end + 1) === '.' || this.kindAt(end + 1) === '<')) {
      const next = this.kindAt(end + 1) === '<' ? this.scanTypeArguments(end + 1) : end + 1;
      if (next < 0 || this.kindAt(next) !== '.') break;
      end = next + 1;
    }
    const name = this.tokens[end];
    if (this.isId(name) || name.kind === 'this' || name.kind === 'operator') this.modifierNameFeatures(from, to, name);
  },
  /** True when the member's modifiers include `required`, or both `private` and `protected`: the two Roslyn reports at the name. */
  hasNameReportedModifier() {
    let accessibility = 0;
    for (let i = this.memberModifiers; i < this.memberModifiersEnd; i++) {
      const token = this.tokens[i];
      if (token.kind === 'identifier' && token.value === 'required') return true;
      if (token.kind === 'private') accessibility |= 1;
      else if (token.kind === 'protected') accessibility |= 2;
    }
    return accessibility === 3;
  },
  namespaceUnexpected(token) {
    this.error(token, 'CS0116', 'A namespace cannot directly contain members such as fields, methods or statements');
  },
  /** A token that cannot continue a member after its type: a misplaced modifier (CS1585) or anything else (CS1519). */
  invalidMemberToken() {
    const token = this.current;
    if (declarationModifiers.has(token.kind) && token.kind !== 'async' && token.kind !== 'partial')
      this.error(token, 'CS1585', `Member modifier '${token.text}' must precede the member type and name`);
    else this.error(token, 'CS1519', `Invalid token '${token.text}' in class, record, struct, or interface member declaration`);
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
    // Roslyn reports an async method at its name.
    if (modifiers.some(m => m.kind === 'AsyncKeyword')) this.feature('Async', this.memberName);
    const [body, expressionBody, semicolon] = this.asyncBody(modifiers, () => this.functionBody('ExpressionBodiedMethod'));
    this.memberForm(this.memberName, !!(body || expressionBody));
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
