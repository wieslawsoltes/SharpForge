/** Consume empty array rank specifiers without consuming an allocation's dimensions. */
export function arrayTypeSuffix(parser, name) {
  while (parser.at('[')) {
    let at = parser.i + 1;
    while (parser.tokens[at]?.kind === ',') at++;
    if (parser.tokens[at]?.kind !== ']') break;
    name += '[' + ','.repeat(at - parser.i - 1) + ']';
    parser.i = at + 1;
  }
  return name;
}

export function skipArrayType(tokens, index) {
  while (tokens[index]?.kind === '[') {
    let at = index + 1;
    while (tokens[at]?.kind === ',') at++;
    if (tokens[at]?.kind !== ']') break;
    index = at + 1;
  }
  return index;
}

export function memoryIndices(parser) {
  parser.expect('[');
  const indices = [parser.expression()];
  while (parser.match(',')) indices.push(parser.expression());
  parser.expect(']');
  return indices;
}

function initializer(parser) {
  parser.expect('{');
  const values = [];
  while (!parser.at('}') && !parser.at('eof')) {
    values.push(parser.at('{') ? initializer(parser) : parser.expression());
    if (!parser.match(',')) break;
  }
  parser.expect('}');
  return values;
}

export function memoryAllocation(parser, token, type, stack = false) {
  let lengths = null;
  if (parser.match('[')) {
    lengths = [];
    do { lengths.push(parser.at(']') || parser.at(',') ? null : parser.expression()); } while (parser.match(','));
    parser.expect(']');
    type += '[' + ','.repeat(lengths.length - 1) + ']';
  }
  const shape = /^(.*)\[([,]*)\]$/.exec(type);
  if (!shape) return null;
  const values = parser.at('{') ? initializer(parser) : null;
  const rank = shape[2].length + 1;
  if (stack) {
    if (rank !== 1) parser.error(token, 'CS1575', 'stackalloc requires a one-dimensional buffer');
    return parser.node('StackAlloc', token, {element: shape[1], length: lengths?.[0] ?? null, values});
  }
  if (rank === 1) return parser.node('NewArray', token, {type, length: lengths?.[0] ?? null, values});
  return parser.node('NewRectangularArray', token, {type, lengths, values, rank});
}

export function memoryPrefix(parser, token) {
  if (token.kind !== 'stackalloc') return null;
  const type = parser.at('[') ? 'var' : parser.type();
  const node = memoryAllocation(parser, token, type, true);
  if (node) return node;
  parser.error(token, 'CS1575', 'stackalloc requires an array size or initializer');
  return parser.node('Error', token);
}
