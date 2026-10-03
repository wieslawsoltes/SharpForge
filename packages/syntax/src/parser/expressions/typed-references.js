/** Runtime intrinsic forms use the existing invocation/argument structure with a type in refvalue's second slot. */
export function typedReferenceExpression(parser) {
  const name = parser.current.kind;
  if (!['__makeref', '__reftype', '__refvalue'].includes(name)) return null;
  const identifier = parser.n('IdentifierName', parser.take()), open = parser.expect('(');
  const args = [parser.n('Argument', null, null, parser.expression())];
  if (name === '__refvalue') args.push(parser.expect(','), parser.n('Argument', null, null, parser.type()));
  return parser.n('InvocationExpression', identifier, parser.n('ArgumentList', open, args, parser.expect(')')));
}
