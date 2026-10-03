import { unsupportedPreview } from '../../preview-revisions.js';
/**
 * C# 15 preview (provisional): the `closed` modifier on classes (closed hierarchies, including `closed record class`)
 * and on enums (closed enums), per the pinned csharplang proposals (see preview-revisions.js). `closed` is a modifier
 * only before a type keyword or another modifier - never valid C# before - and is gated: below preview it reports
 * CS8652. Elsewhere it is an identifier at every LangVersion.
 * Forms the pinned revisions do not define - `closed` on structs, interfaces, delegates or members - parse and
 * report the explicit unsupported-preview diagnostic SF1098.
 */
const followers = new Set(['class', 'enum', 'struct', 'interface', 'delegate', 'public', 'private', 'protected', 'internal', 'static', 'abstract', 'sealed', 'partial', 'unsafe', 'new', 'readonly', 'ref']);
export const closedMethods = {
  isClosedModifier(index) {
    if (!this.isWord(this.tokens[index], 'closed')) return false;
    const next = this.tokens[Math.min(index + 1, this.tokens.length - 1)];
    return followers.has(next.kind) || this.isWord(next, 'record') || this.isWord(next, 'closed');
  },
  /** Called with the modifiers of every declaration: gates `closed` on classes and enums and rejects it elsewhere. */
  closedModifier(modifiers, kind) {
    const token = this.closedAt; if (!token || !modifiers.some(modifier => modifier.kind === 'ClosedKeyword')) return; this.closedAt = null;
    if (kind === 'ClassDeclaration' || kind === 'RecordDeclaration') this.feature('ClosedClasses', token);
    else if (kind === 'EnumDeclaration') this.feature('ClosedEnums', token);
    else { const [code, message] = unsupportedPreview('ClosedClasses', "'closed' applies only to classes and enums"); this.error(token, code, message); }
  }
};
