import { diagnostic } from '@sharpforge/text';
/**
 * C# 9 top-level statements. A member of the compilation unit that is neither a namespace nor a type is a statement,
 * kept as a GlobalStatement in source order; `int F() => 1;` at the top level is therefore a local function and
 * `await` is an operator. Statements must come before namespace and type declarations: the first one that does not
 * reports CS8803, as Roslyn's parser does. The `backEndProfile` parser option turns that error and the C# 9 feature
 * use off for the SharpForge back end, which has always run top-level statements at every language version and
 * wherever they stand.
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
const localFunctionModifiers = new Set(['static', 'async', 'unsafe', 'extern']);
const widthOf = list => {
  let width = 0;
  for (const item of list) width += item.fullWidth;
  return width;
};
export const topLevelMethods = {
  /** True when a use of feature `id` has been recorded; a plain scan, so the common "none" answer allocates nothing. */
  hasFeatureUse(id) {
    const features = this.features;
    for (let i = 0; i < features.length; i++) if (features[i].id === id) return true;
    return false;
  },
  /** A statement at compilation-unit level; `attributeLists` were consumed by the caller. */
  globalStatement(attributeLists) {
    this.statementStart = this.memberStart;
    return this.n('GlobalStatement', null, null, this.statement(attributeLists));
  },
  /**
   * What the tokens at the cursor (after any modifiers) declare at compilation-unit level, as Roslyn decides it:
   * `T name(` or `T name<` is a function, which is a local function statement there; `T name {` and `T name =>` are a
   * property, which is a member (and an error for the binder). Null for anything else.
   */
  topLevelDeclarationShape() {
    const end = this.scanType(this.i);
    if (end <= this.i || !this.isId(this.tokens[end])) return null;
    const next = this.kindAt(end + 1);
    if (next === '(' || next === '<') return 'function';
    return next === '{' || next === '=>' ? 'property' : null;
  },
  /**
   * A top-level function written with member modifiers (`public int F() { }`): still a local function statement, whose
   * modifier tokens end at index `modifiersEnd`; the modifiers a local function cannot have report CS0106.
   */
  globalFunction(attributeLists, modifiersEnd) {
    this.statementStart = this.memberStart;
    this.topLevelModifiersEnd = modifiersEnd;
    return this.n('GlobalStatement', null, null, this.localDeclaration(attributeLists));
  },
  /** Consumes one modifier of a top-level function, reporting CS0106 unless a local function may have it. */
  topLevelFunctionModifier() {
    const token = this.current;
    if (!localFunctionModifiers.has(token.kind)) this.error(token, 'CS0106', `The modifier '${token.text}' is not valid for this item`);
    return token.kind === 'async' || token.kind === 'partial' ? this.takeWord(token.kind) : this.take();
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
    const backEnd = !!this.options.backEndProfile;
    // A reused statement carries the use it had in the previous tree, where it may have been the first statement.
    if (this.blend && this.hasFeatureUse('TopLevelStatements')) this.features = this.features.filter(use => use.id !== 'TopLevelStatements');
    for (const member of members) {
      const start = offset + member.leadingWidth,
        end = offset + member.fullWidth - member.trailingWidth;
      offset += member.fullWidth;
      if (member.kind !== 'GlobalStatement') {
        declared ||= typeOrNamespace.has(member.kind);
        continue;
      }
      if (!statements++ && !backEnd) this.features.push({ id: 'TopLevelStatements', start, end });
      if (declared && !reported && !backEnd) {
        reported = true;
        this.diagnostics.push(
          diagnostic(this.source, start, Math.max(1, end - start), 'CS8803', 'Top-level statements must precede namespace and type declarations.')
        );
      }
    }
  }
};
