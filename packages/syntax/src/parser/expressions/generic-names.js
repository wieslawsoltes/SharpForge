/**
 * Generic-name disambiguation in expressions (C# specification, "Grammar ambiguities"): after `identifier <`,
 * the tokens form a type-argument list only if they scan as one and the token after `>` is one of
 * ( ) ] } : ; , . ? == != | ^ && || & [ - otherwise `<` is the less-than operator.
 */
const followers = new Set(['(', ')', ']', '}', ':', ';', ',', '.', '?', '==', '!=', '|', '^', '&&', '||', '&', '[', 'eof']);
export const genericNameMethods = {
  isGenericNameInExpression(i = this.i) {
    const end = this.scanTypeArguments(i); if (end < 0) return false;
    const next = this.tokens[Math.min(end, this.tokens.length - 1)];
    if (next.kind === '>' ) return false;
    return followers.has(next.kind);
  }
};
