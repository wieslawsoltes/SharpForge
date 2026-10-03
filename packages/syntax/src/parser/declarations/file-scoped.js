/**
 * C# 10 `global using` directives and file-scoped namespaces (`namespace X;`). A file-scoped namespace takes the
 * rest of the file (or of the enclosing braces) as its members. Three ordering rules are checked here because they
 * depend only on where the declaration stands; Roslyn reports them while binding, at the namespace name:
 *   CS8954  a second file-scoped namespace (it is parsed as a member of the first)
 *   CS8955  a file-scoped namespace inside `namespace X { }`, or a `namespace X { }` inside a file-scoped namespace
 *   CS8956  a file-scoped namespace that is not the first member of the file
 */
const messages = {
  CS8954: 'Source file can only contain one file-scoped namespace declaration.',
  CS8955: 'Source file can not contain both file-scoped and normal namespace declarations.',
  CS8956: 'File-scoped namespace must precede all other members in a file.'
};
export const fileScopedMethods = {
  /** The optional `global` of a using directive. */
  globalUsingKeyword() {
    if (!this.atWord('global')) return null;
    this.feature('GlobalUsing', this.current);
    return this.takeWord('global');
  },
  /**
   * `namespace Name;` and everything after it. The caller has consumed `keyword` and `name` and the cursor is at
   * `;`. `head` is { attributeLists, modifiers, keywordToken, nameStart, nameEnd, membersBefore }.
   */
  fileScopedNamespace(head, keyword, name) {
    this.feature('FileScopedNamespace', head.keywordToken);
    const parent = this.namespaceKind,
      code =
        parent === 'FileScopedNamespaceDeclaration' ? 'CS8954' : parent === 'NamespaceDeclaration' ? 'CS8955' : head.membersBefore ? 'CS8956' : null;
    if (code) this.namespaceOrderError(code, head);
    const semicolon = this.take(),
      externs = [],
      usings = [],
      members = [];
    // Inside braces the namespace ends at the brace of the enclosing namespace.
    this.namespaceBody(externs, usings, members, null, this.namespaceClose, 'FileScopedNamespaceDeclaration');
    return this.n('FileScopedNamespaceDeclaration', head.attributeLists, head.modifiers, keyword, name, semicolon, externs, usings, members);
  },
  /** Called for `namespace Name { }`, which may not appear inside a file-scoped namespace; `head` holds nameStart and nameEnd. */
  bracedNamespace(head) {
    if (this.namespaceKind === 'FileScopedNamespaceDeclaration') this.namespaceOrderError('CS8955', head);
  },
  namespaceOrderError(code, head) {
    this.error({ start: head.nameStart.start, end: head.nameEnd.end }, code, messages[code]);
  }
};
