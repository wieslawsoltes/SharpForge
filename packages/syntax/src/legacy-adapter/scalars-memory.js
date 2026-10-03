/** Translate lossless numeric and memory syntax to the execution compiler's serializable AST. */
function numericLiteral(adapter, red) {
  const literal = red.token.value;
  const type = literal.type;
  let value = literal.value;
  if (type === 'decimal') {
    const coefficient = value.mantissa;
    value = {scalar: type, value: [
      Number(BigInt.asIntN(32, coefficient)),
      Number(BigInt.asIntN(32, coefficient >> 32n)),
      Number(BigInt.asIntN(32, coefficient >> 64n)),
      value.scale << 16,
    ]};
  } else if (!['int', 'double'].includes(type)) value = {scalar: type, value: String(value)};
  return adapter.node('Literal', red, {value, type, literalText: red.token.text});
}

function initializer(adapter, red) {
  return red.expressions.map(expression => expression.kind === 'ArrayInitializerExpression'
    ? initializer(adapter, expression) : adapter.expression(expression));
}

function arrayCreation(adapter, red) {
  const implicit = red.kind.startsWith('Implicit');
  const stack = red.kind.includes('StackAlloc');
  const sizes = implicit ? null : red.type.rankSpecifiers[0].sizes;
  const rank = sizes?.length ?? (stack ? 1 : red.commas.length + 1);
  const element = implicit ? 'var' : adapter.type(red.type.elementType);
  const lengths = sizes?.map(size => size.kind === 'OmittedArraySizeExpression' ? null : adapter.expression(size)) ?? null;
  const values = red.initializer ? initializer(adapter, red.initializer) : null;
  if (stack) return adapter.node('StackAlloc', red, {element, length: lengths?.[0] ?? null, values});
  const type = element + '[' + ','.repeat(rank - 1) + ']';
  return rank === 1
    ? adapter.node('NewArray', red, {type, length: lengths?.[0] ?? null, values})
    : adapter.node('NewRectangularArray', red, {type, lengths, values, rank});
}

export function scalarMemoryExpression(adapter, red) {
  if (red.kind === 'NumericLiteralExpression') return numericLiteral(adapter, red);
  if (red.kind === 'ElementAccessExpression') {
    const target = adapter.expression(red.expression), indices = adapter.args(red.argumentList);
    return adapter.from('Index', target, red, {target, index: indices[0], indices});
  }
  if (['ArrayCreationExpression', 'ImplicitArrayCreationExpression',
    'StackAllocArrayCreationExpression', 'ImplicitStackAllocArrayCreationExpression'].includes(red.kind)) {
    return arrayCreation(adapter, red);
  }
  return undefined;
}

export function scalarMemoryType(adapter, red, prefix = '') {
  if (red.kind === 'ArrayType') {
    let type = adapter.type(red.elementType);
    for (const rank of red.rankSpecifiers) type += '[' + ','.repeat(rank.sizes.length - 1) + ']';
    return type;
  }
  if (red.kind === 'GenericName' && /^(?:System\.)?(?:ReadOnlySpan|Span)$/.test(prefix + red.identifier.valueText)) {
    const arguments_ = red.typeArgumentList.arguments.map(argument => adapter.type(argument));
    return red.identifier.valueText + '<' + arguments_.join(', ') + '>';
  }
  return undefined;
}
