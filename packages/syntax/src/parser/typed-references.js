/** Parse CLI typed-reference operators with their distinct expression/type operands. */
export function parseTypedReference(parser) {
  const kind = parser.current.kind,
    keyword = parser.take(),
    open = parser.expect('(');
  const expression = parser.nested(() => parser.expression());
  if (kind === '__refvalue') {
    const comma = parser.expect(','),
      type = parser.type();
    return parser.n('RefValueExpression', keyword, open, expression, comma, type, parser.expect(')'));
  }
  return parser.n(kind === '__makeref' ? 'MakeRefExpression' : 'RefTypeExpression',
    keyword, open, expression, parser.expect(')'));
}
