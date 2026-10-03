/** Punctuation and operator tokens with their Roslyn SyntaxKind names, plus the expression precedence tables. */
export const punctuationKinds = Object.freeze({
  '~': 'TildeToken', '!': 'ExclamationToken', '$': 'DollarToken', '%': 'PercentToken', '^': 'CaretToken', '&': 'AmpersandToken', '*': 'AsteriskToken', '(': 'OpenParenToken', ')': 'CloseParenToken',
  '-': 'MinusToken', '+': 'PlusToken', '=': 'EqualsToken', '{': 'OpenBraceToken', '}': 'CloseBraceToken', '[': 'OpenBracketToken', ']': 'CloseBracketToken', '|': 'BarToken', '\\': 'BackslashToken',
  ':': 'ColonToken', ';': 'SemicolonToken', '"': 'DoubleQuoteToken', "'": 'SingleQuoteToken', '<': 'LessThanToken', ',': 'CommaToken', '>': 'GreaterThanToken', '.': 'DotToken', '?': 'QuestionToken',
  '#': 'HashToken', '/': 'SlashToken', '..': 'DotDotToken', '||': 'BarBarToken', '&&': 'AmpersandAmpersandToken', '--': 'MinusMinusToken', '++': 'PlusPlusToken', '::': 'ColonColonToken',
  '??': 'QuestionQuestionToken', '->': 'MinusGreaterThanToken', '!=': 'ExclamationEqualsToken', '==': 'EqualsEqualsToken', '=>': 'EqualsGreaterThanToken', '<=': 'LessThanEqualsToken',
  '<<': 'LessThanLessThanToken', '<<=': 'LessThanLessThanEqualsToken', '>=': 'GreaterThanEqualsToken', '>>': 'GreaterThanGreaterThanToken', '>>=': 'GreaterThanGreaterThanEqualsToken',
  '/=': 'SlashEqualsToken', '*=': 'AsteriskEqualsToken', '|=': 'BarEqualsToken', '&=': 'AmpersandEqualsToken', '+=': 'PlusEqualsToken', '-=': 'MinusEqualsToken', '^=': 'CaretEqualsToken',
  '%=': 'PercentEqualsToken', '??=': 'QuestionQuestionEqualsToken', '>>>': 'GreaterThanGreaterThanGreaterThanToken', '>>>=': 'GreaterThanGreaterThanGreaterThanEqualsToken' });
/** Tokens the scanner emits directly. `>` runs are never merged here: the parser joins adjacent `>` tokens so `List<List<int>>` closes two lists. */
const scanned = ['<<=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '??', '<<', '&=', '|=', '^=', '::', '->', '..'];
const single = '{}()[];:,.?+-*/%<>=!~&|^';
/** Returns the operator or punctuation text at `i`, or null when the character cannot start a token. */
export function scanOperator(text, i) {
  for (const op of scanned) if (text.startsWith(op, i)) return op;
  return single.includes(text[i]) ? text[i] : null;
}
/** `>`-family operators assembled by the parser from adjacent tokens: [parts, merged text]. Longest first. */
export const greaterThanMerges = Object.freeze([[['>', '>', '>='], '>>>='], [['>', '>', '>'], '>>>'], [['>', '>='], '>>='], [['>', '>'], '>>']]);
export const Precedence = Object.freeze({ Expression: 0, Assignment: 1, Lambda: 2, Conditional: 3, Coalescing: 4, ConditionalOr: 5, ConditionalAnd: 6, LogicalOr: 7, LogicalXor: 8, LogicalAnd: 9, Equality: 10, Relational: 11, Shift: 12, Additive: 13, Multiplicative: 14, Switch: 15, Range: 16, Unary: 17, Cast: 18, PointerIndirection: 19, AddressOf: 20, Primary: 21 });
const P = Precedence;
/** Binary operator text to [precedence, node kind]. */
export const binaryOperators = Object.freeze({
  '??': [P.Coalescing, 'CoalesceExpression'], '||': [P.ConditionalOr, 'LogicalOrExpression'], '&&': [P.ConditionalAnd, 'LogicalAndExpression'], '|': [P.LogicalOr, 'BitwiseOrExpression'],
  '^': [P.LogicalXor, 'ExclusiveOrExpression'], '&': [P.LogicalAnd, 'BitwiseAndExpression'], '==': [P.Equality, 'EqualsExpression'], '!=': [P.Equality, 'NotEqualsExpression'],
  '<': [P.Relational, 'LessThanExpression'], '>': [P.Relational, 'GreaterThanExpression'], '<=': [P.Relational, 'LessThanOrEqualExpression'], '>=': [P.Relational, 'GreaterThanOrEqualExpression'],
  is: [P.Relational, 'IsExpression'], as: [P.Relational, 'AsExpression'], '<<': [P.Shift, 'LeftShiftExpression'], '>>': [P.Shift, 'RightShiftExpression'], '>>>': [P.Shift, 'UnsignedRightShiftExpression'],
  '+': [P.Additive, 'AddExpression'], '-': [P.Additive, 'SubtractExpression'], '*': [P.Multiplicative, 'MultiplyExpression'], '/': [P.Multiplicative, 'DivideExpression'], '%': [P.Multiplicative, 'ModuloExpression'] });
export const assignmentOperators = Object.freeze({
  '=': 'SimpleAssignmentExpression', '+=': 'AddAssignmentExpression', '-=': 'SubtractAssignmentExpression', '*=': 'MultiplyAssignmentExpression', '/=': 'DivideAssignmentExpression', '%=': 'ModuloAssignmentExpression',
  '&=': 'AndAssignmentExpression', '^=': 'ExclusiveOrAssignmentExpression', '|=': 'OrAssignmentExpression', '<<=': 'LeftShiftAssignmentExpression', '>>=': 'RightShiftAssignmentExpression',
  '>>>=': 'UnsignedRightShiftAssignmentExpression', '??=': 'CoalesceAssignmentExpression' });
export const prefixOperators = Object.freeze({ '+': 'UnaryPlusExpression', '-': 'UnaryMinusExpression', '~': 'BitwiseNotExpression', '!': 'LogicalNotExpression', '++': 'PreIncrementExpression', '--': 'PreDecrementExpression', '&': 'AddressOfExpression', '*': 'PointerIndirectionExpression', '^': 'IndexExpression' });
/** Operator tokens that may follow `operator` in a declaration (true and false are keyword tokens). */
export const overloadableOperators = Object.freeze(new Set(['+', '-', '!', '~', '++', '--', 'true', 'false', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>', '==', '!=', '<', '>', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=']));
