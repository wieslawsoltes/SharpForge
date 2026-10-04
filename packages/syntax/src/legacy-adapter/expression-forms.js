/**
 * Legacy AST conversion of each expression kind, as a table from Roslyn node kind to a converter. A converter runs
 * with the adapter as `this` and receives the red node; it returns the legacy node, or null when the form has no
 * legacy counterpart (the adapter then reports it as not supported). Adding a form means adding an entry here.
 */
const literal = type =>
  function (red) {
    return this.node('Literal', red, { value: red.token.value, type });
  };
const boolean = value =>
  function (red) {
    return this.node('Literal', red, { value, type: 'bool' });
  };
function keywordName(red) {
  return this.name(red.token);
}
function postfix(red) {
  const operand = this.expression(red.operand);
  return this.from('Unary', operand, red, { operator: red.operatorToken.text, operand, postfix: true });
}
const wrapped = legacyKind =>
  function (red) {
    return this.node(legacyKind, red, { expression: this.expression(red.expression) });
  };
function switchArm(arm) {
  if (arm.whenClause) this.fail(arm.whenClause, 'SF1018', 'Switch expression guards are not implemented in this profile');
  const kind = arm.pattern.kind,
    pattern = kind === 'DiscardPattern' ? null : kind === 'ConstantPattern' ? this.expression(arm.pattern.expression) : this.unsupported(arm.pattern);
  return this.node('SwitchArm', arm, { pattern, expression: this.expression(arm.expression) });
}
function interpolatedString(red) {
  if (red.stringStartToken.kind.includes('Raw')) return null;
  const parts = [];
  for (const content of red.contents) {
    if (content.kind === 'InterpolatedStringText') {
      if (content.textToken.value) parts.push({ text: content.textToken.value.replaceAll('{{', '{').replaceAll('}}', '}') });
      continue;
    }
    const alignment = content.alignmentClause,
      format = content.formatClause,
      stop = alignment ? alignment.commaToken : format ? format.colonToken : content.closeBraceToken,
      alignmentText = alignment ? alignment.value.toFullString().trim() : '0',
      align = /^[+-]?\d+$/.test(alignmentText) ? Number(alignmentText) : NaN;
    const part = {
      expression: this.expression(content.expression),
      start: content.openBraceToken.span.end,
      end: stop.spanStart,
      alignment: Number.isInteger(align) ? align : 0,
      format: format ? format.formatStringToken.text : ''
    };
    // An alignment that is not an integer literal travels as an expression for the binder to check; `alignment` is 0 then.
    if (alignment && !Number.isInteger(align)) part.alignmentExpression = this.expression(alignment.value);
    parts.push(part);
  }
  return this.node('InterpolatedString', red, { parts });
}
function collectionArgument(argument) {
  if (argument.refKindKeyword) this.fail(argument, 'SF1017', 'By-reference arguments are not implemented in this profile');
  return { name: argument.nameColon ? argument.nameColon.name.identifier.valueText : null, expression: this.expression(argument.expression) };
}
function collectionExpression(red) {
  const elements = [];
  let args = null;
  for (const element of red.elements) {
    if (element.kind === 'WithElement') args = element.argumentList.arguments.map(collectionArgument, this);
    else if (element.kind === 'SpreadElement') elements.push(this.node('SpreadElement', element, { expression: this.expression(element.expression) }));
    else elements.push(this.expression(element.expression));
  }
  return this.node('CollectionExpression', red, { elements, arguments: args });
}
/** `new T(args) { ... }` and `new(args) { ... }`: member initializers become Initializer nodes, collection elements argument lists. */
function objectCreation(red) {
  const type = red.kind === 'ObjectCreationExpression' ? this.type(red.type) : '<target>',
    args = red.argumentList ? this.args(red.argumentList) : [],
    initializers = [],
    collectionInitializers = [],
    initializer = red.initializer;
  for (const item of initializer?.expressions ?? []) {
    if (initializer.kind !== 'ObjectInitializerExpression') {
      const elements = item.kind === 'ComplexElementInitializerExpression' ? item.expressions.map(e => this.expression(e)) : [this.expression(item)];
      collectionInitializers.push(elements);
    } else if (item.kind !== 'SimpleAssignmentExpression' || item.left.kind !== 'IdentifierName')
      this.fail(item, 'SF1018', 'Indexer and nested object initializers are not implemented in this profile');
    else {
      const name = item.left.identifier;
      initializers.push(this.node('Initializer', item, { name: name.valueText, nameSpan: this.nameSpan(name), expression: this.expression(item.right) }));
    }
  }
  return this.node('New', red, { type, args, initializers, collectionInitializers });
}
/** `new T[n]`, `new T[] { ... }` and `new[] { ... }`; only single-dimensional arrays exist in the legacy AST. */
function arrayCreation(red) {
  const implicit = red.kind === 'ImplicitArrayCreationExpression',
    values = red.initializer ? red.initializer.expressions.map(e => this.expression(e)) : null;
  let length = null,
    sized = false,
    type = 'var[]';
  if (implicit) {
    if (red.commas.length) this.fail(red, 'SF1019', 'Multi-dimensional arrays are not implemented in this profile');
  } else {
    const ranks = red.type.rankSpecifiers,
      sizes = ranks[0].sizes;
    type = this.type(red.type.elementType) + '[]';
    if (ranks.length !== 1 || sizes.length !== 1)
      this.fail(red.type, 'SF1019', 'Jagged and multi-dimensional array creation is not implemented in this profile');
    if (sizes[0].kind !== 'OmittedArraySizeExpression') {
      length = this.expression(sizes[0]);
      sized = true;
    }
  }
  return this.node('NewArray', red, { type, length, values: values ?? (sized || implicit ? null : []) });
}
export const expressionForms = Object.freeze({
  IdentifierName(red) {
    return red.identifier.isMissing ? this.node('Error', red, {}) : this.name(red.identifier);
  },
  ThisExpression: keywordName,
  BaseExpression: keywordName,
  // The back end finds the backing field of a property by the name `field`, as it did before the keyword was a node.
  FieldExpression: keywordName,
  PredefinedType(red) {
    return this.name(red.keyword);
  },
  GenericName(red) {
    return this.node('Name', red, { name: this.type(red), nameSpan: { start: red.spanStart, end: red.span.end } });
  },
  NumericLiteralExpression(red) {
    const value = red.token.value;
    return this.node('Literal', red, { value: value.number, type: ['float', 'double', 'decimal'].includes(value.type) ? 'double' : 'int' });
  },
  TrueLiteralExpression: boolean(true),
  FalseLiteralExpression: boolean(false),
  NullLiteralExpression(red) {
    return this.node('Literal', red, { value: null, type: 'null' });
  },
  StringLiteralExpression: literal('string'),
  CharacterLiteralExpression: literal('char'),
  ParenthesizedExpression(red) {
    return this.expression(red.expression);
  },
  SimpleMemberAccessExpression(red) {
    const target = this.expression(red.expression);
    if (red.name.kind !== 'IdentifierName') return null;
    return this.from('Member', target, red, { target, name: red.name.identifier.valueText, nameSpan: this.nameSpan(red.name.identifier) });
  },
  InvocationExpression(red) {
    const target = this.expression(red.expression);
    return this.from('Call', target, red, { target, args: this.args(red.argumentList) });
  },
  ElementAccessExpression(red) {
    const target = this.expression(red.expression),
      args = this.args(red.argumentList);
    if (args.length !== 1) this.fail(red.argumentList, 'SF1018', 'Element access requires exactly one index in this profile');
    return this.from('Index', target, red, { target, index: args[0] ?? this.node('Error', red.argumentList, {}) });
  },
  PostIncrementExpression: postfix,
  PostDecrementExpression: postfix,
  ConditionalAccessExpression(red) {
    const receiver = this.expression(red.expression);
    return this.whenNotNull(red.whenNotNull, receiver, receiver);
  },
  ConditionalExpression(red) {
    const condition = this.expression(red.condition);
    return this.from('Conditional', condition, red, { condition, whenTrue: this.expression(red.whenTrue), whenFalse: this.expression(red.whenFalse) });
  },
  SwitchExpression(red) {
    const governing = this.expression(red.governingExpression);
    return this.from('SwitchExpression', governing, red, { expression: governing, arms: red.arms.map(switchArm, this) });
  },
  CheckedExpression: wrapped('Checked'),
  UncheckedExpression: wrapped('Unchecked'),
  AwaitExpression: wrapped('Await'),
  DefaultExpression(red) {
    return this.node('Default', red, { type: this.type(red.type) });
  },
  CastExpression(red) {
    return this.node('Cast', red, { type: this.type(red.type), expression: this.expression(red.expression) });
  },
  InterpolatedStringExpression: interpolatedString,
  CollectionExpression: collectionExpression,
  ImplicitObjectCreationExpression: objectCreation,
  ObjectCreationExpression: objectCreation,
  ArrayCreationExpression: arrayCreation,
  ImplicitArrayCreationExpression: arrayCreation
});
