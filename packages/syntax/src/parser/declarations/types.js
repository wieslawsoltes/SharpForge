import { reusableMembers } from '../../incremental/blender.js';
/** Class, struct and interface declarations with type parameters, full base lists and constraint clauses. */
const kinds = { class: 'ClassDeclaration', struct: 'StructDeclaration', interface: 'InterfaceDeclaration' };
export const typeDeclarationMethods = {
  /** Parses a type or delegate declaration when one starts here; returns null otherwise. */
  typeLikeDeclaration(attributeLists, modifiers) {
    this.interfaceNestedType();
    if (this.atAny(['class', 'struct', 'interface'])) return this.typeDeclaration(attributeLists, modifiers);
    if (this.at('enum')) return this.enumDeclaration(attributeLists, modifiers);
    if (this.at('delegate') && this.peek().kind !== '*') return this.delegateDeclaration(attributeLists, modifiers);
    if (this.current.kind === 'identifier') {
      if (this.isRecordStart()) return this.recordDeclaration(attributeLists, modifiers);
      if (this.isExtensionStart()) return this.extensionDeclaration(attributeLists, modifiers);
      if (this.isUnionStart()) return this.unionDeclaration(attributeLists, modifiers);
    }
    return null;
  },
  typeDeclaration(attributeLists, modifiers) {
    const keywordIndex = this.i,
      keywordToken = this.current,
      keyword = this.take(),
      kind = kinds[keywordToken.kind],
      nameToken = this.current,
      identifier = this.id();
    this.typeModifierFeatures(modifiers, kind, keywordToken, keywordIndex);
    this.closedModifier(modifiers, kind);
    const typeParameters = this.at('<') ? this.typeParameterList() : null,
      parameterList = this.primaryConstructorParameters();
    const baseList = this.at(':') ? this.baseList() : null,
      constraints = this.constraintClauses();
    if (this.at(';'))
      return this.n(
        kind,
        attributeLists,
        modifiers,
        keyword,
        identifier,
        typeParameters,
        parameterList,
        baseList,
        constraints,
        null,
        null,
        null,
        this.take()
      );
    if (!this.at('{')) return this.n(kind, attributeLists, modifiers, keyword, identifier, typeParameters, parameterList, baseList, constraints, ...this.missingBody());
    const open = this.take(),
      members = this.typeBody(nameToken.value, false, kind);
    return this.n(
      kind,
      attributeLists,
      modifiers,
      keyword,
      identifier,
      typeParameters,
      parameterList,
      baseList,
      constraints,
      open,
      members,
      this.expect('}'),
      this.match(';')
    );
  },
  /** The body of a type whose `{` is absent: both braces are missing and no members are read, as in Roslyn. Returns [open, members, close, semicolon]. */
  missingBody() {
    const open = this.expect('{');
    this.error(this.errorAnchor(), 'CS1513', '} expected');
    return [open, null, this.missing('}'), null];
  },
  /**
   * Members of a type body up to (not including) the closing brace. Tokens that cannot start a member are skipped with
   * CS1519. `kind` is the declaration kind of the type when member rules depend on it (interfaces).
   */
  typeBody(owner, extension = false, kind = null) {
    const members = [],
      async = this.inAsync,
      outer = this.inExtension,
      enclosing = this.owner,
      container = this.containerKind;
    this.inAsync = false;
    this.inExtension = extension;
    this.owner = owner;
    this.containerKind = kind;
    if (!this.enter('Type nesting limit exceeded')) {
      this.leave();
      this.inAsync = async;
      this.inExtension = outer;
      this.owner = enclosing;
      this.containerKind = container;
      return members;
    }
    while (!this.at('}') && !this.at('eof') && !this.at('namespace')) {
      const before = this.i,
        reused = this.blend ? this.reuse(reusableMembers, 'member', owner) : null;
      if (reused) {
        members.push(reused);
        continue;
      }
      if (!this.canStartMember()) {
        this.skipUnexpected('CS1519', `Invalid token '${this.current.text}' in class, record, struct, or interface member declaration`);
        continue;
      }
      members.push(this.memberDeclaration(owner));
      this.guardProgress(before);
    }
    this.leave();
    this.inAsync = async;
    this.inExtension = outer;
    this.owner = enclosing;
    this.containerKind = container;
    return members;
  }
};
