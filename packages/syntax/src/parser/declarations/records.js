import { unsupportedPreview } from '../../preview-revisions.js';
/**
 * C# 9 record declarations: `record R;`, `record R(int X) : B(X), I where ... { members }` and `record class R`.
 * From C# 9 on, `record` at a declaration position always starts a record (as in Roslyn, which makes this breaking
 * change by language version); below C# 9 it stays an ordinary identifier, so `record R;` is a field of type `record`.
 */
export const recordMethods = {
  isRecordStart(token = this.current) {
    return this.languageVersion >= 9 && this.isWord(token, 'record');
  },
  recordDeclaration(attributeLists, modifiers) {
    const start = this.current,
      keyword = this.takeWord('record');
    this.feature('Records', start);
    const classOrStruct = this.recordModifier(),
      kind = classOrStruct?.kind === 'StructKeyword' ? 'RecordStructDeclaration' : 'RecordDeclaration';
    this.typeModifierFeatures(modifiers, kind, start);
    this.closedModifier(modifiers, kind);
    if (!classOrStruct && this.isUnionStart()) {
      // The proposal resolved that a union declaration is a plain struct: `record union` is not a supported form.
      const [code, message] = unsupportedPreview('Unions', "'record union' is not a union declaration form");
      this.error(this.current, code, message);
      return this.unionDeclaration(attributeLists, [...modifiers, keyword]);
    }
    const nameToken = this.current,
      identifier = this.id(),
      typeParameters = this.at('<') ? this.typeParameterList() : null,
      parameterList = this.at('(') ? this.parameterList() : null;
    const baseList = this.at(':') ? this.baseList() : null,
      constraints = this.constraintClauses();
    if (this.at(';'))
      return this.n(
        kind,
        attributeLists,
        modifiers,
        keyword,
        classOrStruct,
        identifier,
        typeParameters,
        parameterList,
        baseList,
        constraints,
        null,
        null,
        null,
        this.take()
      );
    // Without a body the braces are reported missing and the following tokens are left for the enclosing list.
    if (!this.at('{'))
      return this.n(
        kind,
        attributeLists,
        modifiers,
        keyword,
        classOrStruct,
        identifier,
        typeParameters,
        parameterList,
        baseList,
        constraints,
        this.expect('{'),
        null,
        this.expect('}'),
        null
      );
    const open = this.take(),
      members = this.typeBody(nameToken.value);
    return this.n(
      kind,
      attributeLists,
      modifiers,
      keyword,
      classOrStruct,
      identifier,
      typeParameters,
      parameterList,
      baseList,
      constraints,
      open,
      members,
      this.expect('}'),
      this.match(';')
    );
  }
};
