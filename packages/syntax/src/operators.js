/** Longest tokens first; released operator text and precedence remain unchanged. */
export const operatorTokens = Object.freeze([
  '>>>=', '>>>', '..', '>>=', '<<=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||',
  '++', '--', '+=', '-=', '*=', '/=', '%=', '??', '?.', '<<', '>>', '&=', '|=', '^=', '::',
]);

export const operatorPrecedence = Object.freeze({
  '??=': 1, '=': 1, '+=': 1, '-=': 1, '*=': 1, '/=': 1, '%=': 1,
  '&=': 1, '|=': 1, '^=': 1, '<<=': 1, '>>=': 1, '>>>=': 1,
  '??': 3, '||': 4, '&&': 5, '|': 6, '^': 7, '&': 8, '==': 9, '!=': 9,
  '<': 10, '>': 10, '<=': 10, '>=': 10, is: 10, as: 10,
  '<<': 11, '>>': 11, '>>>': 11, '+': 12, '-': 12, '*': 13, '/': 13, '%': 13,
});

export const closeAngleCount = kind => kind === '>' ? 1 : kind === '>>' ? 2 : kind === '>>>' ? 3 : 0;

/** A shift token closes nested type arguments one bracket at a time in type grammar. */
export function splitTypeClose(parser) {
  const token = parser.current;
  const count = closeAngleCount(token.kind);
  if (count < 2) return;
  const pieces = Array.from({length: count}, (_, index) => ({
    ...token, kind: '>', text: '>', start: token.start + index, end: token.start + index + 1,
  }));
  parser.tokens.splice(parser.i, 1, ...pieces);
}
