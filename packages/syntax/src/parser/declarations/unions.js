/**
 * C# 15 preview (provisional): union declarations, per the pinned csharplang proposal (see preview-revisions.js):
 *
 *   union_declaration : attributes? struct_modifier* 'partial'? 'union' identifier type_parameter_list?
 *                       '(' case_types ')' struct_interfaces? type_parameter_constraints_clause*
 *                       ('{' struct_member_declaration* '}' | ';')
 *   case_types        : type (',' type)*
 *
 * `union` is contextual: it starts a declaration only when a name, an optional type-parameter list and a parenthesised
 * list of types (not parameters) follow - a form that was never valid C#, so every program that uses `union` as an
 * identifier parses as before at every LangVersion. The declaration is gated: below preview it reports CS8652.
 * The pinned Roslyn build has no union syntax, so the node kinds here (UnionDeclaration, UnionCaseTypeList) are
 * SharpForge's and may be renamed when Roslyn's are published.
 */
export const unionMethods = {
  isUnionStart(i = this.i) {
    if (!this.isWord(this.tokens[i], 'union') || !this.isId(this.tokens[i + 1] ?? this.tokens[i])) return false;
    let j = i + 2;
    if (this.kindAt(j) === '<') {
      for (j++; ; j++) {
        while (this.kindAt(j) === 'in' || this.kindAt(j) === 'out') j++;
        if (!this.isId(this.tokens[Math.min(j, this.tokens.length - 1)])) return false;
        j++;
        if (this.kindAt(j) === '>') {
          j++;
          break;
        }
        if (this.kindAt(j) !== ',') return false;
      }
    }
    if (this.kindAt(j) !== '(') return false;
    const end = this.scanType(j + 1);
    return end > j + 1 && (this.kindAt(end) === ',' || this.kindAt(end) === ')');
  },
  unionDeclaration(attributeLists, modifiers) {
    const keywordIndex = this.i,
      start = this.current,
      keyword = this.takeWord('union');
    this.feature('Unions', start);
    this.typeModifierFeatures(modifiers, 'UnionDeclaration', start, keywordIndex);
    const nameToken = this.current,
      identifier = this.id(),
      typeParameters = this.at('<') ? this.typeParameterList() : null,
      open = this.expect('('),
      types = [];
    for (;;) {
      const before = this.i;
      types.push(this.type());
      if (this.at(',')) types.push(this.take());
      else break;
      if (before === this.i) break;
    }
    const caseTypes = this.n('UnionCaseTypeList', open, types, this.expect(')')),
      baseList = this.at(':') ? this.baseList() : null,
      constraints = this.constraintClauses();
    if (this.at(';'))
      return this.n(
        'UnionDeclaration',
        attributeLists,
        modifiers,
        keyword,
        identifier,
        typeParameters,
        caseTypes,
        baseList,
        constraints,
        null,
        null,
        null,
        this.take()
      );
    if (!this.at('{'))
      return this.n(
        'UnionDeclaration',
        attributeLists,
        modifiers,
        keyword,
        identifier,
        typeParameters,
        caseTypes,
        baseList,
        constraints,
        this.expect('{'),
        null,
        this.expect('}'),
        null
      );
    const openBrace = this.take(),
      members = this.typeBody(nameToken.value);
    return this.n(
      'UnionDeclaration',
      attributeLists,
      modifiers,
      keyword,
      identifier,
      typeParameters,
      caseTypes,
      baseList,
      constraints,
      openBrace,
      members,
      this.expect('}'),
      this.match(';')
    );
  }
};
