import { LegacyTypeAdapter } from './types.js';
/** Legacy AST adapter for expressions: operators, calls, member access, literals, lambdas and interpolated strings. */
const prefixKinds = new Set([
  'UnaryPlusExpression',
  'UnaryMinusExpression',
  'BitwiseNotExpression',
  'LogicalNotExpression',
  'PreIncrementExpression',
  'PreDecrementExpression'
]);
const binaryKinds = new Set([
  'AddExpression',
  'SubtractExpression',
  'MultiplyExpression',
  'DivideExpression',
  'ModuloExpression',
  'LeftShiftExpression',
  'RightShiftExpression',
  'UnsignedRightShiftExpression',
  'LogicalOrExpression',
  'LogicalAndExpression',
  'BitwiseOrExpression',
  'BitwiseAndExpression',
  'ExclusiveOrExpression',
  'EqualsExpression',
  'NotEqualsExpression',
  'LessThanExpression',
  'LessThanOrEqualExpression',
  'GreaterThanExpression',
  'GreaterThanOrEqualExpression',
  'CoalesceExpression'
]);
const literalTypes = {
  TrueLiteralExpression: 'bool',
  FalseLiteralExpression: 'bool',
  NullLiteralExpression: 'null',
  CharacterLiteralExpression: 'char',
  StringLiteralExpression: 'string'
};
export class LegacyExpressionAdapter extends LegacyTypeAdapter {
  // ---- expressions ------------------------------------------------------------------------------------------------
  args(list, what = 'Named and by-reference arguments') {
    return list.arguments.map(a => {
      if (a.nameColon || a.refKindKeyword) this.fail(a, 'SF1017', `${what} are not implemented in this profile`);
      return this.expression(a.expression);
    });
  }
  name(token, start = token) {
    return this.node('Name', start, { name: token.valueText, escaped: token.text.startsWith('@'), nameSpan: this.nameSpan(token) }, token);
  }
  /** Rebuilds the flat conditional-access shape: `a?.b.c` is Member(ConditionalMember(a, b), c). */
  whenNotNull(red, receiver, start) {
    switch (red.kind) {
      case 'MemberBindingExpression':
        return this.from('ConditionalMember', start, red, {
          target: receiver,
          name: red.name.identifier.valueText,
          nameSpan: this.nameSpan(red.name.identifier)
        });
      case 'ElementBindingExpression':
        return this.from('ConditionalIndex', start, red, { target: receiver, index: this.args(red.argumentList)[0] ?? this.node('Error', red, {}) });
      case 'SimpleMemberAccessExpression':
        return this.from('Member', start, red, {
          target: this.whenNotNull(red.expression, receiver, start),
          name: red.name.identifier.valueText,
          nameSpan: this.nameSpan(red.name.identifier)
        });
      case 'InvocationExpression':
        return this.from('Call', start, red, { target: this.whenNotNull(red.expression, receiver, start), args: this.args(red.argumentList) });
      case 'ElementAccessExpression':
        return this.from('Index', start, red, {
          target: this.whenNotNull(red.expression, receiver, start),
          index: this.args(red.argumentList)[0] ?? this.node('Error', red, {})
        });
      case 'PostIncrementExpression':
      case 'PostDecrementExpression': {
        const operand = this.whenNotNull(red.operand, receiver, start);
        return this.from('Unary', start, red, { operator: red.operatorToken.text, operand, postfix: true });
      }
      case 'ConditionalAccessExpression':
        return this.whenNotNull(red.whenNotNull, this.whenNotNull(red.expression, receiver, start), start);
    }
    if (red.kind.endsWith('AssignmentExpression')) {
      const left = this.whenNotNull(red.left, receiver, start);
      return this.from('Assignment', start, red, { operator: red.operatorToken.text, left, right: this.expression(red.right) });
    }
    return this.unsupported(red);
  }
  /** Converts an expression. Left-deep chains (long concatenations, fluent calls) nest without a parser limit, so the conversion has its own depth budget. */
  expression(red) {
    if ((this.depth = (this.depth ?? 0) + 1) > 800) {
      this.depth--;
      if (!this.tooDeep) {
        this.tooDeep = true;
        this.fail(red, 'SF1099', 'Expression is too long or complex to compile');
      }
      return this.unsupported(red);
    }
    const result = this.expressionCore(red);
    this.depth--;
    return result;
  }
  expressionCore(red) {
    const kind = red.kind;
    if (binaryKinds.has(kind)) {
      const left = this.expression(red.left);
      return this.from('Binary', left, red, { operator: red.operatorToken.text, left, right: this.expression(red.right) });
    }
    if (kind.endsWith('AssignmentExpression')) {
      const left = this.expression(red.left);
      return this.from('Assignment', left, red, { operator: red.operatorToken.text, left, right: this.expression(red.right) });
    }
    if (prefixKinds.has(kind))
      return this.node('Unary', red, { operator: red.operatorToken.text, operand: this.expression(red.operand), postfix: false });
    switch (kind) {
      case 'IdentifierName':
        return red.identifier.isMissing ? this.node('Error', red, {}) : this.name(red.identifier);
      case 'ThisExpression':
      case 'BaseExpression':
        return this.name(red.token);
      case 'PredefinedType':
        return this.name(red.keyword);
      case 'GenericName':
        return this.node('Name', red, { name: this.type(red), nameSpan: { start: red.spanStart, end: red.span.end } });
      case 'NumericLiteralExpression': {
        const literal = red.token.value;
        return this.node('Literal', red, { value: literal.number, type: ['float', 'double', 'decimal'].includes(literal.type) ? 'double' : 'int' });
      }
      case 'TrueLiteralExpression':
      case 'FalseLiteralExpression':
        return this.node('Literal', red, { value: kind === 'TrueLiteralExpression', type: 'bool' });
      case 'NullLiteralExpression':
        return this.node('Literal', red, { value: null, type: 'null' });
      case 'StringLiteralExpression':
      case 'CharacterLiteralExpression':
        return this.node('Literal', red, { value: red.token.value, type: literalTypes[kind] });
      case 'ParenthesizedExpression':
        return this.expression(red.expression);
      case 'SimpleMemberAccessExpression': {
        const target = this.expression(red.expression);
        if (red.name.kind !== 'IdentifierName') break;
        return this.from('Member', target, red, { target, name: red.name.identifier.valueText, nameSpan: this.nameSpan(red.name.identifier) });
      }
      case 'InvocationExpression': {
        const target = this.expression(red.expression);
        return this.from('Call', target, red, { target, args: this.args(red.argumentList) });
      }
      case 'ElementAccessExpression': {
        const target = this.expression(red.expression),
          args = this.args(red.argumentList);
        if (args.length !== 1) this.fail(red.argumentList, 'SF1018', 'Element access requires exactly one index in this profile');
        return this.from('Index', target, red, { target, index: args[0] ?? this.node('Error', red.argumentList, {}) });
      }
      case 'PostIncrementExpression':
      case 'PostDecrementExpression': {
        const operand = this.expression(red.operand);
        return this.from('Unary', operand, red, { operator: red.operatorToken.text, operand, postfix: true });
      }
      case 'ConditionalAccessExpression': {
        const receiver = this.expression(red.expression);
        return this.whenNotNull(red.whenNotNull, receiver, receiver);
      }
      case 'ConditionalExpression': {
        const condition = this.expression(red.condition);
        return this.from('Conditional', condition, red, {
          condition,
          whenTrue: this.expression(red.whenTrue),
          whenFalse: this.expression(red.whenFalse)
        });
      }
      case 'SwitchExpression': {
        const governing = this.expression(red.governingExpression);
        return this.from('SwitchExpression', governing, red, {
          expression: governing,
          arms: red.arms.map(arm => {
            if (arm.whenClause) this.fail(arm.whenClause, 'SF1018', 'Switch expression guards are not implemented in this profile');
            const pattern =
              arm.pattern.kind === 'DiscardPattern'
                ? null
                : arm.pattern.kind === 'ConstantPattern'
                  ? this.expression(arm.pattern.expression)
                  : this.unsupported(arm.pattern);
            return this.node('SwitchArm', arm, { pattern, expression: this.expression(arm.expression) });
          })
        });
      }
      case 'CheckedExpression':
      case 'UncheckedExpression':
        return this.node(kind === 'CheckedExpression' ? 'Checked' : 'Unchecked', red, { expression: this.expression(red.expression) });
      case 'AwaitExpression':
        return this.node('Await', red, { expression: this.expression(red.expression) });
      case 'DefaultExpression':
        return this.node('Default', red, { type: this.type(red.type) });
      case 'CastExpression':
        return this.node('Cast', red, { type: this.type(red.type), expression: this.expression(red.expression) });
      case 'InterpolatedStringExpression': {
        if (red.stringStartToken.kind.includes('Raw')) break;
        const parts = [];
        for (const content of red.contents) {
          if (content.kind === 'InterpolatedStringText') {
            if (content.textToken.value) parts.push({ text: content.textToken.value.replaceAll('{{', '{').replaceAll('}}', '}') });
            continue;
          }
          const alignment = content.alignmentClause,
            format = content.formatClause,
            stop = alignment ? alignment.commaToken : format ? format.colonToken : content.closeBraceToken,
            align = alignment ? Number(alignment.value.toFullString().trim()) : 0;
          parts.push({
            expression: this.expression(content.expression),
            start: content.openBraceToken.span.end,
            end: stop.spanStart,
            alignment: Number.isInteger(align) ? align : 0,
            format: format ? format.formatStringToken.text : ''
          });
        }
        return this.node('InterpolatedString', red, { parts });
      }
      case 'CollectionExpression': {
        const elements = [];
        let args = null;
        for (const element of red.elements) {
          if (element.kind === 'WithElement')
            args = element.argumentList.arguments.map(a => {
              if (a.refKindKeyword) this.fail(a, 'SF1017', 'By-reference arguments are not implemented in this profile');
              return { name: a.nameColon ? a.nameColon.name.identifier.valueText : null, expression: this.expression(a.expression) };
            });
          else if (element.kind === 'SpreadElement')
            elements.push(this.node('SpreadElement', element, { expression: this.expression(element.expression) }));
          else elements.push(this.expression(element.expression));
        }
        return this.node('CollectionExpression', red, { elements, arguments: args });
      }
      case 'ImplicitObjectCreationExpression':
      case 'ObjectCreationExpression': {
        const type = kind === 'ObjectCreationExpression' ? this.type(red.type) : '<target>',
          args = red.argumentList ? this.args(red.argumentList) : [],
          initializers = [],
          collectionInitializers = [],
          initializer = red.initializer;
        for (const item of initializer?.expressions ?? []) {
          if (initializer.kind === 'ObjectInitializerExpression') {
            if (item.kind !== 'SimpleAssignmentExpression' || item.left.kind !== 'IdentifierName') {
              this.fail(item, 'SF1018', 'Indexer and nested object initializers are not implemented in this profile');
              continue;
            }
            initializers.push(
              this.node('Initializer', item, {
                name: item.left.identifier.valueText,
                nameSpan: this.nameSpan(item.left.identifier),
                expression: this.expression(item.right)
              })
            );
          } else
            collectionInitializers.push(
              item.kind === 'ComplexElementInitializerExpression' ? item.expressions.map(e => this.expression(e)) : [this.expression(item)]
            );
        }
        return this.node('New', red, { type, args, initializers, collectionInitializers });
      }
      case 'ArrayCreationExpression':
      case 'ImplicitArrayCreationExpression': {
        const implicit = kind === 'ImplicitArrayCreationExpression',
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
    }
    return this.unsupported(red);
  }
}
