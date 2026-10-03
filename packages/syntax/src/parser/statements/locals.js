/**
 * Local declarations: `int a = 1, b;`, `const` locals, the lookahead that tells a declaration from an expression
 * statement, and `for` statements with comma-separated initialisers and incrementors. A declaration whose name is
 * followed by `(` or `<` is a local function (see local-functions.js).
 */
const typeDeclarationKeywords = new Set(['class', 'struct', 'interface', 'enum']);
const localFollowers = new Set(['=', ';', ',', ')', '(', '<', '[', 'in', 'eof', '}']);
export const localStatementMethods = {
  /** True when a local variable declaration or local function starts at `i` (a type followed by an identifier). */
  isLocalDeclaration(i = this.i) {
    const token = this.tokens[i];
    if (token.kind === 'await') return !this.inAsync && this.isId(this.tokens[i + 1]) && ['=', ';', ','].includes(this.kindAt(i + 2));
    if (this.isWord(token, 'scoped') && (this.kindAt(i + 1) === 'ref' || this.isLocalDeclaration(i + 1))) return true;
    if (this.isPredefined(token) && this.kindAt(i + 1) === '.') return false;
    // `T struct S { }`: a type name directly before a type declaration is a declaration whose name is missing (Roslyn's
    // recovery); this is what `record struct S` is below C# 9.
    if ((token.kind === 'identifier' || this.isPredefined(token)) && typeDeclarationKeywords.has(this.kindAt(i + 1))) return true;
    const info = {},
      j = this.scanType(i, info);
    if (j < 0 || j === i) return false;
    const name = this.tokens[j];
    if (!this.isId(name)) return false;
    return localFollowers.has(this.kindAt(j + 1)) || !!info.predefined;
  },
  isLocalModifier(i = this.i) {
    const kind = this.kindAt(i);
    if (kind === 'const' || kind === 'extern' || kind === 'readonly' || kind === 'volatile') return true;
    if (kind === 'static') return this.isLocalModifier(i + 1) || this.isLocalDeclaration(i + 1);
    if (kind === 'unsafe') return this.kindAt(i + 1) !== '{' && !this.isUnsafeExpression(i);
    if (kind === 'async') return this.isAsyncModifier(i, false);
    return false;
  },
  /** `type name = value, ...` without the terminating semicolon (used by for, using and fixed). */
  variableDeclaration() {
    const type =
      this.atWord('scoped') && (this.peek().kind === 'ref' || this.isLocalDeclaration(this.i + 1))
        ? this.n('ScopedType', this.takeWord('scoped'), this.type())
        : this.type();
    return this.n('VariableDeclaration', type, this.variableDeclarators());
  },
  localDeclaration(attributeLists, awaitKeyword = null, usingKeyword = null) {
    const modifiers = [],
      firstModifier = this.i;
    // A top-level function may be written with member modifiers; they are consumed (and reported) here.
    const memberModifiersEnd = this.topLevelModifiersEnd;
    this.topLevelModifiersEnd = 0;
    for (;;) {
      if (this.i < memberModifiersEnd) modifiers.push(this.topLevelFunctionModifier());
      else if (this.isLocalModifier()) modifiers.push(this.at('async') ? this.takeWord('async') : this.take());
      else break;
    }
    const start = this.current,
      type =
        this.atWord('scoped') && (this.peek().kind === 'ref' || this.isLocalDeclaration(this.i + 1))
          ? this.n('ScopedType', this.takeWord('scoped'), this.type())
          : this.type();
    if (type.kind === 'RefType') this.feature('RefLocalsReturns', start);
    const nameToken = this.current,
      identifier = this.id();
    if (this.fieldKeyword && !this.isLocalFunctionAhead()) this.fieldNamedVariable(nameToken, nameToken, nameToken);
    if (this.isLocalFunctionAhead() && !usingKeyword)
      return this.localFunctionStatement({ attributeLists, modifiers, firstModifier, type, identifier, nameToken });
    if (type.kind === 'IdentifierName' && start.value === 'var' && !start.flags) this.feature('ImplicitLocal', start);
    return this.n(
      'LocalDeclarationStatement',
      attributeLists,
      awaitKeyword,
      usingKeyword,
      modifiers,
      this.n('VariableDeclaration', type, this.variableDeclarators(identifier)),
      this.expect(';')
    );
  },
  forStatement(attrs) {
    const keyword = this.take(),
      open = this.expect('('),
      list = stop => {
        const items = [];
        while (!this.at(stop) && !this.at('eof')) {
          const before = this.i;
          items.push(this.expression());
          if (this.at(',')) items.push(this.take());
          else break;
          if (before === this.i) break;
        }
        return items;
      };
    const declaration = !this.at(';') && this.isLocalDeclaration() ? this.variableDeclaration() : null,
      initializers = declaration ? null : list(';'),
      first = this.expect(';');
    const condition = this.at(';') ? null : this.expression(),
      second = this.expect(';'),
      incrementors = list(')');
    return this.n(
      'ForStatement',
      attrs,
      keyword,
      open,
      declaration,
      initializers,
      first,
      condition,
      second,
      incrementors,
      this.expect(')'),
      this.embedded()
    );
  }
};
