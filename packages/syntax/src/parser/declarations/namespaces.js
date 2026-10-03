import { accessibilityModifiers } from '../modifiers.js';
import { reusableNamespaceMembers } from '../../incremental/blender.js';
/** Compilation units, extern aliases, using directives (namespace, static and alias forms) and namespace declarations, kept in source order. */
const memberOnly = new Set([...accessibilityModifiers, 'virtual', 'override', 'abstract', 'sealed', 'volatile']);
/** Modifiers that can only start a local declaration after `using` (`static` and `unsafe` may start a directive). */
const localOnlyModifiers = new Set(['const', 'readonly', 'volatile', 'extern']);
export const namespaceMethods = {
  compilationUnit() {
    const externs = [],
      usings = [],
      attributeLists = [],
      members = [];
    this.namespaceBody(externs, usings, members, attributeLists, null, 'CompilationUnit');
    this.topLevelOrder([...externs, ...usings, ...attributeLists], members);
    const unit = this.n('CompilationUnit', externs, usings, attributeLists, members, this.take());
    this.fieldKeywordAmbiguity(unit);
    return unit;
  },
  isExternAlias() {
    return this.at('extern') && this.isWord(this.peek(), 'alias') && this.isId(this.peek(2));
  },
  /**
   * `global using` is always a directive. A plain `using` is one too, except at compilation-unit level where
   * `using (...)` is a statement and `using T x` (or `using ref`, `using var`) a using declaration.
   */
  isUsingDirective(inNamespace, i = this.i) {
    if (this.isWord(this.tokens[i], 'global') && this.kindAt(i + 1) === 'using') return true;
    if (this.kindAt(i) !== 'using') return false;
    const next = this.tokens[i + 1];
    if (next.kind === '(') return false;
    if (inNamespace) return true;
    if (next.kind === 'ref' || localOnlyModifiers.has(next.kind) || this.isPredefined(next) || this.isWord(next, 'scoped')) return false;
    const type = next.kind === 'static' ? i + 2 : i + 1,
      end = this.scanType(type);
    return !(end > type && this.isId(this.tokens[end]));
  },
  /** Roslyn reports an extern alias that follows a using, an attribute or a member on its `extern` keyword and skips the directive. */
  misplacedExternAlias() {
    this.error(this.current, 'CS0439', 'An extern alias declaration must precede all other elements defined in the namespace');
    for (let count = 0; count < 3; count++) this.skip();
    if (this.at(';')) this.skip();
  },
  externAlias() {
    this.feature('ExternAlias', this.current);
    return this.n('ExternAliasDirective', this.take(), this.takeWord('alias'), this.id(), this.expect(';'));
  },
  usingDirective() {
    const global = this.globalUsingKeyword(),
      using = this.take(),
      isStatic = this.usingStaticKeyword(),
      unsafe = this.usingUnsafeKeyword();
    let alias = null;
    if (this.isId() && this.peek().kind === '=') alias = this.n('NameEquals', this.n('IdentifierName', this.id()), this.take());
    const target = alias ? this.usingAliasTarget(!!unsafe) : this.name();
    return this.n('UsingDirective', global, using, isStatic, unsafe, alias, target, this.expect(';'));
  },
  /** `namespace Name { ... }` or the file-scoped `namespace Name;`. `membersBefore` counts the members that precede it in its parent. */
  namespaceDeclaration(attributeLists, modifiers, membersBefore) {
    const keywordToken = this.current,
      keyword = this.take(),
      nameStart = this.current,
      name = this.name(),
      head = { attributeLists, modifiers, keywordToken, nameStart, nameEnd: this.tokens[Math.max(this.i - 1, 0)], membersBefore };
    if (this.at(';')) return this.fileScopedNamespace(head, keyword, name);
    this.bracedNamespace(head);
    const open = this.expect('{'),
      externs = [],
      usings = [],
      members = [];
    if (this.enter('Namespace nesting limit exceeded')) this.namespaceBody(externs, usings, members, null, '}', 'NamespaceDeclaration');
    this.leave();
    return this.n(
      'NamespaceDeclaration',
      attributeLists,
      modifiers,
      keyword,
      name,
      open,
      externs,
      usings,
      members,
      this.expect('}'),
      this.match(';')
    );
  },
  /**
   * Parses extern aliases, usings and members until `close` (or end of file). `unitAttributes` collects assembly/module
   * attribute lists; `kind` is the node kind the members belong to.
   */
  namespaceBody(externs, usings, members, unitAttributes, close, kind) {
    const inNamespace = !unitAttributes,
      outerKind = this.namespaceKind,
      outerClose = this.namespaceClose;
    this.namespaceKind = kind;
    this.namespaceClose = close;
    let reportUnexpected = true;
    while (!this.at('eof') && !(close && this.at(close))) {
      const before = this.i,
        reused = this.blend ? this.reuse(reusableNamespaceMembers, 'namespace', inNamespace) : null;
      if (reused) {
        members.push(reused);
        continue;
      }
      // Extern aliases, usings, unit attributes and members are kept in that order in the tree, so a directive that
      // comes after a later part cannot be added to its list: it is reported and skipped.
      const attributed = !!unitAttributes && unitAttributes.length > 0;
      if (this.isExternAlias()) {
        if (!members.length && !usings.length && !attributed) externs.push(this.externAlias());
        else this.misplacedExternAlias();
      } else if (this.isUsingDirective(inNamespace)) {
        if (!members.length && !attributed) usings.push(this.usingDirective());
        else {
          // The misplaced directive is parsed only to find its end; Roslyn reports the error over all of it.
          const first = this.current,
            mark = this.mark();
          this.usingDirective();
          const end = this.i;
          this.reset(mark);
          this.error(
            { start: first.start, end: this.tokens[Math.max(end - 1, this.i)].end },
            'CS1529',
            'A using clause must precede all other elements defined in the namespace except extern alias declarations'
          );
          while (this.i < end) this.skip();
        }
      } else if (
        unitAttributes &&
        !members.length &&
        this.at('[') &&
        (this.isWord(this.peek(), 'assembly') || this.isWord(this.peek(), 'module')) &&
        this.peek(2).kind === ':'
      )
        unitAttributes.push(this.attributeList());
      else if (!inNamespace && this.at('}')) this.skipUnexpected('CS1022', 'Type or namespace definition, or end-of-file expected');
      else if (!this.canStartNamespaceMember(inNamespace)) {
        // Roslyn reports a token that starts nothing as CS1022: every one at compilation-unit level, and inside a namespace
        // only the first of a run (statement keywords included: a namespace holds no statements). The back end profile
        // keeps CS1525 everywhere: recorded compiler evidence (planning/contracts) pins that code.
        if (this.options.backEndProfile) this.skipUnexpected('CS1525', `Invalid expression term '${this.current.text}'`);
        else if (!inNamespace || reportUnexpected) this.skipUnexpected('CS1022', 'Type or namespace definition, or end-of-file expected');
        else this.skip();
        reportUnexpected = false;
        this.guardProgress(before);
        continue;
      } else members.push(this.namespaceMember(inNamespace, members.length));
      reportUnexpected = true;
      this.guardProgress(before);
    }
    this.namespaceKind = outerKind;
    this.namespaceClose = outerClose;
  },
  /** Whether the current token can start a member here; statements exist only at compilation-unit level (and in the back end profile). */
  canStartNamespaceMember(inNamespace) {
    if (this.canStartMember() || this.at('namespace')) return true;
    return (!inNamespace || !!this.options.backEndProfile) && this.canStartStatement();
  },
  /** A namespace, type, delegate, member declaration or (at compilation-unit level) a global statement. */
  namespaceMember(inNamespace, membersBefore) {
    this.memberStart = this.i;
    this.memberErrors = this.diagnostics.length;
    const attributeLists = this.isAttributeListAhead() ? this.attributeLists() : [],
      mark = this.mark();
    this.memberModifiers = this.i;
    const modifiers = this.modifiers();
    this.memberModifiersEnd = this.i;
    if (this.at('namespace')) return this.namespaceDeclaration(attributeLists, modifiers, membersBefore);
    const type = this.typeLikeDeclaration(attributeLists, modifiers);
    if (type) return type;
    // `new T(...);` at compilation-unit level is an object-creation statement: `new` is a modifier only before `Type name`.
    const creation = !inNamespace && modifiers.length === 1 && modifiers[0].text === 'new' && !this.isId(this.tokens[this.scanType(this.i)]);
    const shape = inNamespace || creation ? null : this.topLevelDeclarationShape();
    if (shape === 'property') return this.memberDeclarationAfterModifiers(attributeLists, modifiers, null);
    if (shape === 'function' && modifiers.length) {
      const modifiersEnd = this.memberModifiersEnd;
      this.reset(mark);
      return this.globalFunction(attributeLists, modifiersEnd);
    }
    const memberish =
      inNamespace || modifiers.some(m => memberOnly.has(m.text)) || this.at('event') || this.at('~') || this.atAny(['implicit', 'explicit']);
    if (memberish) return this.memberDeclarationAfterModifiers(attributeLists, modifiers, null);
    this.reset(mark);
    return this.globalStatement(attributeLists);
  }
};
