/** Field-like events, events with add/remove accessors, and explicit interface member names (`I<T>.Member`). */
export const eventMethods = {
  /** True when the identifier at `i` is an interface name qualifying a member: followed (after type arguments) by `.` or `::`. */
  isExplicitInterfaceAhead(i = this.i) {
    if (!this.isId(this.tokens[i])) return false;
    i++;
    if (this.kindAt(i) === '<') {
      i = this.scanTypeArguments(i);
      if (i < 0) return false;
    }
    return this.kindAt(i) === '.' || this.kindAt(i) === '::';
  },
  /** Parses `Name.` segments before a member name, `this` or `operator`; returns an ExplicitInterfaceSpecifier or null. */
  explicitInterfaceSpecifier() {
    if (!this.isExplicitInterfaceAhead()) return null;
    let name = null,
      dot = null;
    while (this.isExplicitInterfaceAhead()) {
      let segment;
      if (this.peek().kind === '::') {
        const alias = this.n('IdentifierName', this.atWord('global') ? this.takeWord('global') : this.id());
        segment = this.n('AliasQualifiedName', alias, this.take(), this.simpleName(true));
      } else segment = this.simpleName(true);
      name = name ? this.n('QualifiedName', name, dot, segment) : segment;
      dot = this.expect('.');
    }
    return this.n('ExplicitInterfaceSpecifier', name, dot);
  },
  eventDeclaration(attributeLists, modifiers) {
    const keyword = this.take(),
      type = this.type(),
      explicit = this.explicitInterfaceSpecifier();
    const nameToken = this.current,
      bodies = this.accessorBodies;
    if (explicit || this.peek().kind === '{') {
      const identifier = this.id(),
        accessors = this.at('{') ? this.accessorList() : null;
      this.accessorMemberForm(nameToken, bodies, -1);
      return this.n(
        'EventDeclaration',
        attributeLists,
        modifiers,
        keyword,
        type,
        explicit,
        identifier,
        accessors,
        accessors ? null : this.expect(';')
      );
    }
    this.memberForm(nameToken, false);
    return this.n(
      'EventFieldDeclaration',
      attributeLists,
      modifiers,
      keyword,
      this.n('VariableDeclaration', type, this.variableDeclarators()),
      this.expect(';')
    );
  }
};
