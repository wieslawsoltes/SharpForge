/**
 * `break` and `continue`, with the C# 15 preview label: `break outer;` and `continue outer;` name the labeled loop
 * or switch they target. The grammar is that of the csharplang proposal pinned in preview-revisions.js
 * (csharp-15.0/labeled-break-continue.md):
 *
 *   break_statement    : 'break' identifier? ';'
 *   continue_statement : 'continue' identifier? ';'
 *
 * The pinned Roslyn build does not parse the label, so the `identifier` slot of BreakStatement and ContinueStatement
 * is SharpForge's own. Whether the label names an enclosing loop or switch is a binding question.
 */
export const labeledJumpMethods = {
  breakOrContinueStatement(attributeLists) {
    const kind = this.current.kind === 'break' ? 'BreakStatement' : 'ContinueStatement';
    const keyword = this.take();
    const labelToken = this.current;
    const label = this.isId() ? this.take('IdentifierToken') : null;
    if (label) this.feature('LabeledBreakContinue', labelToken);
    return this.n(kind, attributeLists, keyword, label, this.expect(';'));
  }
};
