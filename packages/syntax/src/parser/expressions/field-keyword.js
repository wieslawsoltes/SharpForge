import { diagnostic } from '@sharpforge/text';
/**
 * The C# 14 `field` keyword: inside the accessors of a property (and its expression body) the identifier `field`
 * is the compiler-synthesized backing field, a FieldExpression. Everywhere else, after a `.`, when escaped as
 * `@field`, and at LangVersion 13 and below, it is an ordinary identifier.
 * Two diagnostics that Roslyn reports while binding depend only on the syntax and are reported here:
 *   CS9258 (warning)  `field` is the keyword although the containing type declares a member named `field`;
 *                     `this.field` or `@field` refers to the member. Members inherited from a base type are not
 *                     visible to the parser, so that case is left to the binder.
 *   CS9273            a local or parameter named `field` is declared inside an accessor.
 * Neither is reported under the `backEndProfile` parser option: the SharpForge compiler checks both itself.
 * The warning is computed over the finished tree, from the recorded feature uses, so an incremental parse that
 * reuses members gives the same result as a full parse.
 */
const typeKinds = new Set(['ClassDeclaration', 'StructDeclaration', 'InterfaceDeclaration', 'RecordDeclaration', 'RecordStructDeclaration']);
const containers = new Set([...typeKinds, 'NamespaceDeclaration', 'FileScopedNamespaceDeclaration', 'CompilationUnit']);
const namedMembers = new Set(['MethodDeclaration', 'PropertyDeclaration', 'EventDeclaration', ...typeKinds, 'EnumDeclaration', 'DelegateDeclaration']);
const ambiguous =
  "In this language version, the 'field' keyword binds to a synthesized backing field for the property. " +
  "To avoid generating a synthesized backing field, and to refer to the existing member, use 'this.field' or '@field' instead.";
const shadowed =
  "In this language version, 'field' is a keyword within a property accessor. Rename the variable or use the identifier '@field' instead.";
export const fieldKeywordMethods = {
  /** Runs `parse` (a parser method) as the accessors or expression body of a property, where `field` is the keyword. */
  inPropertyAccessors(parse) {
    const saved = this.fieldKeyword;
    this.fieldKeyword = this.languageVersion >= 14;
    try {
      return parse.call(this);
    } finally {
      this.fieldKeyword = saved;
    }
  },
  /** True when the identifier at the cursor is the `field` keyword. */
  isFieldExpression() {
    return this.fieldKeyword && this.isWord(this.current, 'field') && this.peek().kind !== '::';
  },
  fieldExpression() {
    this.feature('FieldKeyword', this.current);
    return this.n('FieldExpression', this.takeWord('field'));
  },
  /** Reports CS9273 for a local or parameter named `field` declared where `field` is the keyword; `from` and `to` bound its tokens. */
  fieldNamedVariable(nameToken, from, to) {
    if (!this.fieldKeyword || this.options.backEndProfile || !this.isWord(nameToken, 'field')) return;
    this.error({ start: from.start, end: to.end }, 'CS9273', shadowed);
  },
  /** Warns (CS9258) about each `field` keyword whose containing type declares a member named `field`. */
  fieldKeywordAmbiguity(unit) {
    if (this.options.backEndProfile) return;
    const uses = this.features.filter(use => use.id === 'FieldKeyword');
    if (!uses.length) return;
    uses.sort((a, b) => a.start - b.start);
    this.warnInTypes(unit, 0, uses);
  },
  /** Walks the containers under `node` (which starts at `offset`) down to the types that hold feature uses. */
  warnInTypes(node, offset, uses) {
    const end = offset + node.fullWidth;
    if (!uses.some(use => use.start >= offset && use.start < end)) return;
    const types = [];
    let position = offset;
    for (const child of node.children) {
      if (!child) continue;
      if (child.isNode && child.isList) {
        let at = position;
        for (const member of child.children) {
          if (member.isNode && containers.has(member.kind)) types.push([member, at]);
          at += member.fullWidth;
        }
      }
      position += child.fullWidth;
    }
    if (typeKinds.has(node.kind) && declaresField(node)) {
      const nested = types.filter(([type]) => typeKinds.has(type.kind));
      for (const use of uses) {
        if (use.start < offset || use.start >= end || nested.some(([type, at]) => use.start >= at && use.start < at + type.fullWidth)) continue;
        this.diagnostics.push(diagnostic(this.source, use.start, use.end - use.start, 'CS9258', ambiguous, 'warning'));
      }
    }
    for (const [type, at] of types) this.warnInTypes(type, at, uses);
  }
};
/** True when a type declaration (green node) declares a member named `field`. */
function declaresField(type) {
  for (const child of type.children) {
    if (!child || !child.isNode || !child.isList) continue;
    for (const member of child.children) if (member.isNode && memberNames(member).includes('field')) return true;
  }
  return false;
}
/** The names a member declaration (green node) declares: its identifier, or its variable declarators. */
function memberNames(member) {
  if (namedMembers.has(member.kind)) {
    const identifiers = member.children.filter(child => child && child.isToken && child.kind === 'IdentifierToken');
    return identifiers.map(token => token.text);
  }
  if (member.kind !== 'FieldDeclaration' && member.kind !== 'EventFieldDeclaration') return [];
  const declaration = member.children.find(child => child && child.kind === 'VariableDeclaration'),
    names = [];
  for (const declarator of declaration?.children[1]?.children ?? []) if (declarator.kind === 'VariableDeclarator') names.push(declarator.children[0].text);
  return names;
}
