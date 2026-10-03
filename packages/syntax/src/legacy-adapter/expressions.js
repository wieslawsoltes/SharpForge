import { LegacyTypeAdapter } from './types.js';
import { expressionForms } from './expression-forms.js';
/** Legacy AST adapter for expressions: operators here, every other form through the table in expression-forms.js. */
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
    const form = expressionForms[kind];
    return (form && form.call(this, red)) ?? this.unsupported(red);
  }
}
