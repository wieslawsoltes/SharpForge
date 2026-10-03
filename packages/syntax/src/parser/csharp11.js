/**
 * C# 11 forms that hook into older grammar: generic attributes (`[Attr<T>]`), the `file` type modifier, static
 * abstract and static virtual interface members (methods, properties, events and operators) and `checked` operator
 * declarations. Each is recorded where Roslyn reports it.
 */
export const csharp11Methods = {
  /**
   * `file` is a modifier before a member of a type or namespace from C# 11 on. At the top level of a file, where a
   * statement could start, and in older versions it is one only when a declaration follows, so `file x;` and
   * `file.M()` still use an identifier named file.
   */
  isFileModifier(index) {
    const token = this.tokens[index];
    if (!this.isWord(token, 'file')) return false;
    const atTopLevel = this.typeDepth === 0 && (this.namespaceKind === 'CompilationUnit' || this.namespaceKind === null);
    if (this.languageVersion >= 11 && !atTopLevel) return true;
    return this.canFollowContextualModifier(this.tokens[Math.min(index + 1, this.tokens.length - 1)], index + 1);
  },
  /** Records the file-types feature at the name of the type declaration that starts at the cursor (at its keyword). */
  fileTypeName(modifiers) {
    if (!modifiers.some(modifier => modifier.kind === 'FileKeyword')) return;
    const name = this.typeNameAhead();
    if (name) this.feature('FileTypes', name);
  },
  /** An attribute name parsed from token index `start`: a generic one (`Attr<T>`, `N.Attr<T>`) is a C# 11 feature over the whole name. */
  genericAttributeName(start) {
    if (this.kindAt(this.i - 1) === '>') this.feature('GenericAttributes', this.tokens[start], this.tokens[this.i - 1]);
  },
  /**
   * A `static abstract` or `static virtual` member of an interface: Roslyn reports the `abstract` or `virtual`
   * modifier as not valid before C# 11, at `nameToken`.
   */
  staticAbstractMember(nameToken) {
    if (!this.inInterface()) return;
    let isStatic = false,
      modifier = null;
    for (let i = this.memberModifiers; i < this.memberModifiersEnd; i++) {
      const kind = this.tokens[i].kind;
      if (kind === 'static') isStatic = true;
      else if (kind === 'abstract' || kind === 'virtual') modifier = kind;
    }
    if (isStatic && modifier) this.feature('StaticAbstractMembersInInterfaces', nameToken, nameToken, modifier);
  },
  /** The optional `checked` after `operator` in an operator or conversion declaration. */
  checkedOperatorKeyword() {
    if (!this.at('checked')) return null;
    this.feature('CheckedUserDefinedOperators', this.current);
    return this.take();
  }
};
