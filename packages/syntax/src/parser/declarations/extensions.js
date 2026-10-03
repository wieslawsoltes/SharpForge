/**
 * C# 14 extension blocks: `extension<T>(Receiver r) where T : ... { members }` inside static classes, including the
 * receiver-less form `extension(string) { static members }`. From C# 14 on `extension` at a member position always
 * starts a block; below C# 14 only `extension<` does, so `extension(int a) { }` stays a constructor of a type named
 * `extension`, as in Roslyn.
 */
export const extensionMethods = {
  isExtensionStart() {
    return this.atWord('extension') && (this.languageVersion >= 14 || this.peek().kind === '<');
  },
  extensionDeclaration(attributeLists, modifiers) {
    const start = this.current,
      keyword = this.takeWord('extension');
    this.feature('Extensions', start);
    if (this.isId() && !this.atWord('where')) {
      this.error(this.current, 'CS9281', 'Extension declarations may not have a name.');
      this.skip();
    }
    const typeParameters = this.at('<') ? this.typeParameterList() : null,
      parameterList = this.extensionReceiver(),
      constraints = this.constraintClauses();
    if (this.at(';'))
      return this.n(
        'ExtensionBlockDeclaration',
        attributeLists,
        modifiers,
        keyword,
        typeParameters,
        parameterList,
        constraints,
        null,
        null,
        null,
        this.take()
      );
    if (!this.at('{'))
      return this.n(
        'ExtensionBlockDeclaration',
        attributeLists,
        modifiers,
        keyword,
        typeParameters,
        parameterList,
        constraints,
        this.expect('{'),
        null,
        this.expect('}'),
        null
      );
    const open = this.take(),
      members = this.typeBody(null, true);
    return this.n(
      'ExtensionBlockDeclaration',
      attributeLists,
      modifiers,
      keyword,
      typeParameters,
      parameterList,
      constraints,
      open,
      members,
      this.expect('}'),
      this.match(';')
    );
  },
  /** The receiver: one parameter whose name is optional (`extension(string)` declares static extension members only). */
  extensionReceiver() {
    const open = this.expect('('),
      parameters = [];
    while (!this.at(')') && !this.at('eof') && !this.at('{') && !this.at(';')) {
      const before = this.i,
        attributeLists = this.attributeLists(),
        modifiers = this.parameterModifiers(),
        type = this.type(),
        identifier = this.isId() ? this.take('IdentifierToken') : null,
        // A receiver cannot have a default value; Roslyn parses it and reports CS9284 while binding.
        defaultValue = this.parameterDefault();
      parameters.push(this.n('Parameter', attributeLists, modifiers, type, identifier, defaultValue));
      if (this.at(',')) parameters.push(this.take());
      else break;
      if (before === this.i) break;
    }
    if (!parameters.length && !open.isMissing) {
      this.error(this.current, 'CS1031', 'Type expected');
      parameters.push(this.n('Parameter', null, null, this.n('IdentifierName', this.cache.missing('IdentifierToken')), null, null));
    }
    return this.n('ParameterList', open, parameters, this.expect(')'));
  }
};
