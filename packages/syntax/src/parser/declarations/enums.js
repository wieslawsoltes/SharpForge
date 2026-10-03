/** Enum declarations: underlying type, member initialisers, attributes on members and a trailing comma. */
export const enumMethods = {
  enumDeclaration(attributeLists, modifiers) {
    const keyword = this.take(), identifier = this.id(), baseList = this.at(':') ? this.baseList() : null;
    if (this.at(';')) return this.n('EnumDeclaration', attributeLists, modifiers, keyword, identifier, baseList, null, null, null, this.take());
    const open = this.expect('{'), members = [];
    while (!this.at('}') && !this.at('eof')) {
      const before = this.i;
      if (!this.isId() && !this.at('[')) { this.skipUnexpected('CS1001', 'Identifier expected'); continue; }
      const memberAttributes = this.attributeLists(), name = this.id();
      members.push(this.n('EnumMemberDeclaration', memberAttributes, null, name, this.at('=') ? this.n('EqualsValueClause', this.take(), this.expression()) : null));
      if (this.at(',')) members.push(this.take());
      else if (this.isId() || this.at('[')) { this.error(this.errorAnchor(), 'CS1003', "Syntax error, ',' expected"); members.push(this.missing(',')); }
      else if (!this.at('}')) { if (this.at(';')) { this.error(this.current, 'CS1003', "Syntax error, ',' expected"); this.skip(); } else break; }
      this.guardProgress(before);
    }
    return this.n('EnumDeclaration', attributeLists, modifiers, keyword, identifier, baseList, open, members, this.expect('}'), this.match(';'));
  }
};
