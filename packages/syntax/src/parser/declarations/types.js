/** Class, struct and interface declarations with type parameters, full base lists and constraint clauses. */
const kinds = { class: 'ClassDeclaration', struct: 'StructDeclaration', interface: 'InterfaceDeclaration' };
export const typeDeclarationMethods = {
  /** Parses a type or delegate declaration when one starts here; returns null otherwise. */
  typeLikeDeclaration(attributeLists, modifiers) {
    if (this.atAny(['class', 'struct', 'interface'])) return this.typeDeclaration(attributeLists, modifiers);
    if (this.at('enum')) return this.enumDeclaration(attributeLists, modifiers);
    if (this.at('delegate') && this.peek().kind !== '*') return this.delegateDeclaration(attributeLists, modifiers);
    return null;
  },
  typeDeclaration(attributeLists, modifiers) {
    const keywordToken = this.current, keyword = this.take(), kind = kinds[keywordToken.kind], nameToken = this.current, identifier = this.id();
    for (const modifier of modifiers) {
      const feature = modifier.kind === 'PartialKeyword' ? 'PartialTypes' : modifier.kind === 'StaticKeyword' && kind === 'ClassDeclaration' ? 'StaticClasses' : modifier.kind === 'RefKeyword' ? 'RefStructs' : modifier.kind === 'ReadOnlyKeyword' && kind === 'StructDeclaration' ? 'ReadOnlyStructs' : null;
      if (feature) this.feature(feature, keywordToken);
    }
    const typeParameters = this.at('<') ? this.typeParameterList() : null;
    let parameterList = null; if (this.at('(')) { this.feature('PrimaryConstructors', this.current); parameterList = this.parameterList(); }
    const baseList = this.at(':') ? this.baseList() : null, constraints = this.constraintClauses();
    if (this.at(';')) return this.n(kind, attributeLists, modifiers, keyword, identifier, typeParameters, parameterList, baseList, constraints, null, null, null, this.take());
    const open = this.expect('{'), members = this.typeBody(nameToken.value);
    return this.n(kind, attributeLists, modifiers, keyword, identifier, typeParameters, parameterList, baseList, constraints, open, members, this.expect('}'), this.match(';'));
  },
  baseList() {
    const colon = this.take(), types = [];
    for (;;) {
      const before = this.i, type = this.type();
      types.push(this.at('(') ? this.n('PrimaryConstructorBaseType', type, this.argumentList()) : this.n('SimpleBaseType', type));
      if (this.at(',')) types.push(this.take()); else break; if (before === this.i) break;
    }
    return this.n('BaseList', colon, types);
  },
  /** Members of a type body up to (not including) the closing brace. Tokens that cannot start a member are skipped with CS1519. */
  typeBody(owner) {
    const members = [], async = this.inAsync; this.inAsync = false;
    while (!this.at('}') && !this.at('eof') && !this.at('namespace')) {
      const before = this.i;
      if (!this.canStartMember()) { this.skipUnexpected('CS1519', `Invalid token '${this.current.text}' in class, record, struct, or interface member declaration`); continue; }
      members.push(this.memberDeclaration(owner)); this.guardProgress(before);
    }
    this.inAsync = async; return members;
  }
};
