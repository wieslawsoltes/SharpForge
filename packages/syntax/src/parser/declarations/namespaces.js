import { accessibilityModifiers } from '../modifiers.js';
import { reusableNamespaceMembers } from '../../incremental/blender.js';
/** Compilation units, extern aliases, using directives (namespace, static and alias forms) and namespace declarations, kept in source order. */
const memberOnly = new Set([...accessibilityModifiers, 'virtual', 'override', 'abstract', 'sealed', 'volatile', 'new']);
const directiveFollowers = new Set([';', 'eof', 'using', 'namespace', 'class', 'struct', 'interface', 'enum', 'public', 'internal', '[']);
export const namespaceMethods = {
  compilationUnit() {
    const externs = [],
      usings = [],
      attributeLists = [],
      members = [];
    this.namespaceBody(externs, usings, members, attributeLists, null);
    return this.n('CompilationUnit', externs, usings, attributeLists, members, this.take());
  },
  isExternAlias() {
    return this.at('extern') && this.isWord(this.peek(), 'alias') && this.isId(this.peek(2));
  },
  /** `using` starts a directive unless it is a using statement or using declaration. */
  isUsingDirective(i = this.i) {
    if (this.isWord(this.tokens[i], 'global') && this.kindAt(i + 1) === 'using') i++;
    if (this.kindAt(i) !== 'using') return false;
    const next = this.tokens[i + 1];
    if (next.kind === '(') return false;
    if (next.kind === 'static' || next.kind === 'unsafe') return true;
    if (this.isId(next) && this.kindAt(i + 2) === '=') return true;
    const end = this.scanName(i + 1);
    return end >= 0 && directiveFollowers.has(this.kindAt(end));
  },
  externAlias() {
    this.feature('ExternAlias', this.current);
    return this.n('ExternAliasDirective', this.take(), this.takeWord('alias'), this.id(), this.expect(';'));
  },
  usingDirective() {
    const global = this.atWord('global') ? this.takeWord('global') : null,
      using = this.take(),
      isStatic = this.match('static'),
      unsafe = this.match('unsafe');
    let alias = null;
    if (global) this.feature('GlobalUsing', this.tokens[this.i - 1]);
    if (isStatic) this.feature('UsingStatic', this.tokens[this.i - 1]);
    if (this.isId() && this.peek().kind === '=') alias = this.n('NameEquals', this.n('IdentifierName', this.id()), this.take());
    const targetStart = this.current,
      target = alias ? this.type() : this.name();
    if (
      alias &&
      target.kind !== 'IdentifierName' &&
      target.kind !== 'QualifiedName' &&
      target.kind !== 'GenericName' &&
      target.kind !== 'AliasQualifiedName'
    )
      this.feature('UsingTypeAlias', targetStart, this.tokens[this.i - 1]);
    return this.n('UsingDirective', global, using, isStatic, unsafe, alias, target, this.expect(';'));
  },
  namespaceDeclaration(attributeLists, modifiers) {
    const keyword = this.take(),
      name = this.name();
    if (this.at(';')) {
      const semicolon = this.take(),
        externs = [],
        usings = [],
        members = [];
      this.feature('FileScopedNamespace', this.tokens[this.i - 1]);
      this.namespaceBody(externs, usings, members, null, null);
      return this.n('FileScopedNamespaceDeclaration', attributeLists, modifiers, keyword, name, semicolon, externs, usings, members);
    }
    const open = this.expect('{'),
      externs = [],
      usings = [],
      members = [];
    if (this.enter('Namespace nesting limit exceeded')) this.namespaceBody(externs, usings, members, null, '}');
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
  /** Parses extern aliases, usings and members until `close` (or end of file). `unitAttributes` collects assembly/module attribute lists. */
  namespaceBody(externs, usings, members, unitAttributes, close) {
    const inNamespace = !unitAttributes;
    while (!this.at('eof') && !(close && this.at(close))) {
      const before = this.i,
        reused = this.blend ? this.reuse(reusableNamespaceMembers, 'namespace', inNamespace) : null;
      if (reused) {
        members.push(reused);
        continue;
      }
      if (!members.length && !usings.length && this.isExternAlias()) externs.push(this.externAlias());
      else if (this.isUsingDirective()) {
        if (!members.length) usings.push(this.usingDirective());
        else {
          this.error(
            this.current,
            'CS1529',
            'A using clause must precede all other elements defined in the namespace except extern alias declarations'
          );
          const mark = this.mark();
          this.usingDirective();
          const end = this.i;
          this.reset(mark);
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
      else if (!this.canStartMember() && !this.canStartStatement() && !this.at('namespace'))
        this.skipUnexpected('CS1525', `Invalid expression term '${this.current.text}'`);
      else members.push(this.namespaceMember(inNamespace));
      this.guardProgress(before);
    }
  },
  /** A namespace, type, delegate, member declaration or (at compilation-unit level) a global statement. */
  namespaceMember(inNamespace) {
    const attributeLists = this.isAttributeListAhead() ? this.attributeLists() : [],
      mark = this.mark(),
      modifiers = this.modifiers();
    if (this.at('namespace')) return this.namespaceDeclaration(attributeLists, modifiers);
    const type = this.typeLikeDeclaration(attributeLists, modifiers);
    if (type) return type;
    const memberish =
      inNamespace || modifiers.some(m => memberOnly.has(m.text)) || this.at('event') || this.at('~') || this.atAny(['implicit', 'explicit']);
    if (memberish) return this.memberDeclarationAfterModifiers(attributeLists, modifiers, null);
    this.reset(mark);
    return this.n('GlobalStatement', null, null, this.statement(attributeLists));
  }
};
