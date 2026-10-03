import { diagnostic } from '@sharpforge/text';
/**
 * C# 9 top-level statements. A member of the compilation unit that is neither a namespace nor a type is a statement,
 * kept as a GlobalStatement in source order; `int F() => 1;` at the top level is therefore a local function and
 * `await` is an operator. Statements must come before namespace and type declarations: the first one that does not
 * reports CS8803, as Roslyn's parser does. The `backEndProfile` parser option turns that error off for the SharpForge
 * back end, which has always accepted statements after type declarations.
 * The order checks run once over the finished member list rather than while parsing, so an incremental parse that
 * reuses members gives the same result as a full parse.
 */
const typeOrNamespace = new Set([
  'NamespaceDeclaration',
  'FileScopedNamespaceDeclaration',
  'ClassDeclaration',
  'StructDeclaration',
  'InterfaceDeclaration',
  'EnumDeclaration',
  'DelegateDeclaration',
  'RecordDeclaration',
  'RecordStructDeclaration'
]);
const widthOf = list => {
  let width = 0;
  for (const item of list) width += item.fullWidth;
  return width;
};
export const topLevelMethods = {
  /** A statement at compilation-unit level; `attributeLists` were consumed by the caller. */
  globalStatement(attributeLists) {
    this.statementStart = this.memberStart;
    return this.n('GlobalStatement', null, null, this.statement(attributeLists));
  },
  /**
   * Records the top-level-statements feature at the first global statement and reports CS8803 at the first statement
   * that follows a type or namespace. `before` holds the green nodes in front of `members` (extern aliases, usings
   * and attribute lists), which give the members their offsets.
   */
  topLevelOrder(before, members) {
    let offset = widthOf(before),
      declared = false,
      statements = 0,
      reported = false;
    // A reused statement carries the use it had in the previous tree, where it may have been the first statement.
    if (this.blend) this.features = this.features.filter(use => use.id !== 'TopLevelStatements');
    for (const member of members) {
      const start = offset + member.leadingWidth,
        end = offset + member.fullWidth - member.trailingWidth;
      offset += member.fullWidth;
      if (member.kind !== 'GlobalStatement') {
        declared ||= typeOrNamespace.has(member.kind);
        continue;
      }
      if (!statements++) this.features.push({ id: 'TopLevelStatements', start, end });
      if (declared && !reported && !this.options.backEndProfile) {
        reported = true;
        this.diagnostics.push(
          diagnostic(this.source, start, Math.max(1, end - start), 'CS8803', 'Top-level statements must precede namespace and type declarations.')
        );
      }
    }
  }
};
