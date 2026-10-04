const scalarKinds = new Set(['NumericLiteralExpression', 'StringLiteralExpression', 'CharacterLiteralExpression',
  'TrueLiteralExpression', 'FalseLiteralExpression', 'NullLiteralExpression']);

/** Evaluate only compile-time attribute data; unresolved expressions are explicit descriptors for a semantic/data provider. */
export function attributeConstant(node, options = {}) {
  const {resolveConstant, depth = 0} = options;
  if (!node || depth > 32) throw new Error('Attribute expression nesting limit exceeded');
  const next = child => attributeConstant(child, {...options, depth: depth + 1});
  if (resolveConstant) {
    const resolved = resolveConstant(node);
    if (resolved?.hasValue) return resolved.value;
  }
  if (scalarKinds.has(node.kind)) {
    if (node.kind === 'NullLiteralExpression') return null;
    if (node.kind === 'TrueLiteralExpression') return true;
    if (node.kind === 'FalseLiteralExpression') return false;
    if (node.kind === 'NumericLiteralExpression') return node.token?.value?.value ?? node.token?.value?.number ?? node.token?.value;
    return node.token?.value ?? node.token?.valueText;
  }
  if (node.kind === 'ParenthesizedExpression') return next(node.expression);
  if (['UnaryMinusExpression', 'UnaryPlusExpression', 'LogicalNotExpression', 'BitwiseNotExpression'].includes(node.kind)) {
    const value = next(node.operand);
    if (node.kind === 'LogicalNotExpression' && typeof value === 'boolean') return !value;
    if (typeof value !== 'number' && typeof value !== 'bigint') return {kind: 'unresolved', expression: node.toString()};
    if (node.kind === 'UnaryMinusExpression') return -value;
    if (node.kind === 'BitwiseNotExpression') return ~value;
    return value;
  }
  if (node.kind === 'TypeOfExpression') return {kind: 'type', name: node.type.toString()};
  if (node.kind === 'InvocationExpression' && node.expression.toString() === 'nameof') {
    return node.argumentList.arguments[0]?.expression.toString().split('.').at(-1);
  }
  if (['ArrayInitializerExpression', 'CollectionInitializerExpression'].includes(node.kind)) return node.expressions.map(next);
  if (['ArrayCreationExpression', 'ImplicitArrayCreationExpression'].includes(node.kind) && node.initializer) return next(node.initializer);
  if (node.kind === 'CollectionExpression') return node.elements.map(element => next(element.expression));
  if (node.kind === 'CastExpression') return next(node.expression);
  return {kind: 'unresolved', expression: node.toString()};
}

export function hasUnresolved(value) {
  return Array.isArray(value) ? value.some(hasUnresolved) : !!value && typeof value === 'object' && value.kind === 'unresolved';
}

/** Normalize syntax or compiler attribute records to a framework-independent attribute-data shape. */
export function normalizeTestAttribute(attribute, options = {}) {
  if (typeof attribute.type === 'string') return {...attribute, arguments: [...attribute.arguments ?? []], named: {...attribute.named}};
  const raw = attribute.name.toString().replace(/^global::/, '');
  const type = options.resolveAttributeType?.(attribute) ?? raw;
  const positional = [];
  const named = {};
  for (const argument of attribute.argumentList?.arguments ?? []) {
    const value = attributeConstant(argument.expression, options);
    const name = argument.nameEquals?.name.toString() ?? argument.nameColon?.name.toString();
    if (name) named[name] = value;
    else positional.push(value);
  }
  return {type, arguments: positional, named, span: attribute.span};
}

export function shortAttributeName(attribute) { return attribute.type.split('.').at(-1).replace(/Attribute$/, ''); }

export function attributesOf(symbol, name) {
  return (symbol.attributes ?? []).filter(attribute => shortAttributeName(attribute) === name);
}

export function firstAttribute(symbol, name) { return attributesOf(symbol, name)[0]; }

/** Framework-compatible value display for scalar theory rows, retaining escaped quotes and nulls. */
export function displayArgument(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (Array.isArray(value)) return '[' + value.map(displayArgument).join(', ') + ']';
  if (value?.kind === 'type') return 'typeof(' + value.name + ')';
  return String(value);
}

export function testTraits(...symbols) {
  const traits = Object.create(null);
  const add = (name, value) => { if (value !== undefined) (traits[name] ??= []).push(String(value)); };
  for (const symbol of symbols) {
    for (const attribute of attributesOf(symbol, 'Trait')) add(attribute.arguments[0], attribute.arguments[1]);
    for (const name of ['Category', 'TestCategory']) {
      for (const attribute of attributesOf(symbol, name)) for (const value of attribute.arguments.flat()) add('Category', value);
    }
  }
  return traits;
}
