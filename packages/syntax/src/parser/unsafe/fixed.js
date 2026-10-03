/**
 * C# 1 `fixed (T* p = expression, q = other) statement`. The C# 2 fixed-size buffer field (`fixed int buffer[8];`) is a
 * field whose `fixed` modifier and bracketed declarator size are parsed with the other members in declarations/members.js.
 */
export const fixedStatementMethods = {
  fixedStatement(attributeLists) {
    const keyword = this.take();
    const open = this.expect('(');
    const declaration = this.variableDeclaration();
    return this.n('FixedStatement', attributeLists, keyword, open, declaration, this.expect(')'), this.embedded());
  }
};
