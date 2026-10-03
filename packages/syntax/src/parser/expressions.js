import { Precedence, binaryOperators, assignmentOperators, prefixOperators } from '../lexer/operators.js';
/** Expression parsing by precedence climbing: assignment, conditional, binary, unary, postfix and primary forms. */
const P = Precedence,
  literalKinds = {
    NumericLiteralToken: 'NumericLiteralExpression',
    CharacterLiteralToken: 'CharacterLiteralExpression',
    TrueKeyword: 'TrueLiteralExpression',
    FalseKeyword: 'FalseLiteralExpression',
    NullKeyword: 'NullLiteralExpression',
    ArgListKeyword: 'ArgListExpression'
  };
export const expressionMethods = {
  missingName() {
    return this.n('IdentifierName', this.cache.missing('IdentifierToken'));
  },
  /** Runs `parse` with the conditional-colon context cleared, as inside brackets a `:` cannot end an outer conditional. */
  nested(parse) {
    const saved = this.colonDepth;
    this.colonDepth = 0;
    try {
      return parse();
    } finally {
      this.colonDepth = saved;
    }
  },
  expressionOrRef() {
    return this.at('ref') ? this.n('RefExpression', this.take(), this.expression()) : this.expression();
  },
  /** Parses an expression whose binary operators all bind at least as tightly as `min`. */
  expression(min = P.Expression) {
    if (!this.enter('Expression nesting limit exceeded')) {
      this.leave();
      this.skip();
      return this.missingName();
    }
    const left = this.binary(this.unary(min), min);
    this.leave();
    return left;
  },
  binary(left, min) {
    for (;;) {
      const operator = this.operatorAt(),
        text = operator.text,
        start = this.current;
      if (assignmentOperators[text]) {
        if (min > P.Assignment) break;
        const token = this.takeOperator(operator);
        if (text === '??=') this.feature('CoalesceAssignmentExpression', start);
        else if (text === '>>>=') this.feature('UnsignedRightShift', start, this.tokens[this.i - 1]);
        left = this.n(
          assignmentOperators[text],
          left,
          token,
          text === '=' && this.at('ref') ? this.expressionOrRef() : this.expression(P.Assignment)
        );
        continue;
      }
      if (text === '?') {
        if (min > P.Conditional) break;
        const question = this.take();
        this.colonDepth = (this.colonDepth ?? 0) + 1;
        const whenTrue = this.expressionOrRef();
        this.colonDepth--;
        left = this.n('ConditionalExpression', left, question, whenTrue, this.expect(':'), this.expressionOrRef());
        continue;
      }
      if (text === 'switch') {
        if (min > P.Switch) break;
        left = this.switchExpression(left);
        continue;
      }
      if (text === '..') {
        if (min > P.Range) break;
        this.feature('RangeOperator', start);
        const token = this.take();
        left = this.n('RangeExpression', left, token, this.canStartExpression() ? this.expression(P.Unary) : null);
        continue;
      }
      if (this.isWithExpression()) {
        if (min > P.Switch) break;
        left = this.withExpression(left);
        continue;
      }
      const entry = binaryOperators[text];
      if (!entry || entry[0] < min) break;
      const [precedence, kind] = entry;
      if (text === 'is') {
        left = this.isExpression(left, this.take());
        continue;
      }
      if (text === 'as') {
        left = this.n('AsExpression', left, this.take(), this.type('afterIs'));
        continue;
      }
      if (text === '>>>') this.feature('UnsignedRightShift', start, this.tokens[this.i + operator.count - 1]);
      const token = this.takeOperator(operator);
      left = this.n(kind, left, token, this.expression(text === '??' ? precedence : precedence + 1));
    }
    return left;
  },
  unary(min) {
    const token = this.current,
      kind = token.kind;
    if (min <= P.Lambda || kind === 'delegate' || kind === 'static' || kind === 'async') {
      const lambda = this.anonymousFunction(min);
      if (lambda) return lambda;
    }
    if (Object.hasOwn(prefixOperators, kind)) {
      if (kind === '^') this.feature('IndexOperator', token);
      const operator = this.take();
      return this.n(prefixOperators[kind], operator, this.expression(P.Unary));
    }
    if (kind === '..') {
      this.feature('RangeOperator', token);
      const operator = this.take();
      return this.n('RangeExpression', null, operator, this.canStartExpression() ? this.expression(P.Unary) : null);
    }
    if (kind === 'await' && this.canStartExpression(this.peek()) && this.peek().kind !== '[') {
      this.feature('Async', token);
      return this.n('AwaitExpression', this.takeWord('await'), this.expression(P.Unary));
    }
    if (kind === '(' && this.isCast()) {
      const open = this.take(),
        type = this.type(),
        close = this.expect(')');
      return this.n('CastExpression', open, type, close, this.expression(P.Cast));
    }
    if (kind === 'throw') {
      this.feature('ThrowExpression', token);
      return this.n('ThrowExpression', this.take(), this.expression(P.Coalescing));
    }
    if (kind === 'ref') return this.n('RefExpression', this.take(), this.expression());
    return this.postfix(this.primary(min), min);
  },
  /** The cast rule of the specification: `(T)` is a cast when T must be a type or the following token can only start an operand. */
  isCast() {
    const info = {},
      end = this.scanType(this.i + 1, info);
    if (end < 0 || this.kindAt(end) !== ')') return false;
    if (info.must) return true;
    const next = this.tokens[Math.min(end + 1, this.tokens.length - 1)],
      kind = next.kind;
    if (
      kind === 'is' ||
      kind === 'as' ||
      kind === 'switch' ||
      kind === '[' ||
      (kind === 'await' && !this.canStartExpression(this.tokens[Math.min(end + 2, this.tokens.length - 1)]))
    )
      return false;
    return (
      this.isId(next) ||
      [
        'integer',
        'double',
        'string',
        'char',
        'interpolated',
        '(',
        '!',
        '~',
        'true',
        'false',
        'null',
        'this',
        'base',
        'new',
        'typeof',
        'sizeof',
        'default',
        'checked',
        'unchecked',
        'delegate',
        'throw',
        'stackalloc',
        'ref',
        '__arglist'
      ].includes(kind) ||
      this.isPredefined(next)
    );
  },
  postfix(expression, min = P.Expression, binding = false) {
    for (;;) {
      const token = this.current,
        kind = token.kind;
      if (binding && (kind === '++' || kind === '--' || (kind === '!' && !['.', '[', '(', '?'].includes(this.peek().kind)))) return expression;
      if (kind === '(') expression = this.n('InvocationExpression', expression, this.argumentList());
      else if (kind === '[') expression = this.n('ElementAccessExpression', expression, this.bracketedArgumentList());
      else if (kind === '.') expression = this.n('SimpleMemberAccessExpression', expression, this.take(), this.simpleName(false));
      else if (kind === '->') expression = this.n('PointerMemberAccessExpression', expression, this.take(), this.simpleName(false));
      else if (kind === '++' || kind === '--')
        expression = this.n(kind === '++' ? 'PostIncrementExpression' : 'PostDecrementExpression', expression, this.take());
      else if (kind === '!' && this.isSuppression()) {
        this.feature('NullableReferenceTypes', token);
        expression = this.n('SuppressNullableWarningExpression', expression, this.take());
      } else if (kind === '?' && this.isConditionalAccess()) {
        this.feature('NullPropagatingOperator', token);
        expression = this.n('ConditionalAccessExpression', expression, this.take(), this.conditionalAccessTail(min));
      } else return expression;
    }
  },
  primary(min) {
    const token = this.current,
      kind = token.kind;
    if (kind === 'interpolated') return this.interpolatedString();
    if (Object.hasOwn(literalKinds, token.syntaxKind)) return this.n(literalKinds[token.syntaxKind], this.take());
    if (token.syntaxKind.endsWith('StringLiteralToken'))
      return this.n(token.flags?.utf8 ? 'Utf8StringLiteralExpression' : 'StringLiteralExpression', this.take());
    switch (kind) {
      case 'default':
        if (this.peek().kind === '(') {
          this.feature('Default', token);
          return this.n('DefaultExpression', this.take(), this.take(), this.type(), this.expect(')'));
        }
        this.feature('DefaultLiteral', token);
        return this.n('DefaultLiteralExpression', this.take());
      case 'typeof':
        return this.n('TypeOfExpression', this.take(), this.expect('('), this.type(), this.expect(')'));
      case 'sizeof':
        return this.n('SizeOfExpression', this.take(), this.expect('('), this.type(), this.expect(')'));
      case 'checked':
      case 'unchecked': {
        const keyword = this.take(),
          open = this.expect('('),
          expression = this.nested(() => this.expression());
        return this.n(kind === 'checked' ? 'CheckedExpression' : 'UncheckedExpression', keyword, open, expression, this.expect(')'));
      }
      case 'this':
        return this.n('ThisExpression', this.take());
      case 'base':
        return this.n('BaseExpression', this.take());
      case 'new':
        return this.newExpression();
      case 'stackalloc':
        return this.stackAllocExpression();
      case 'unsafe':
        if (this.isUnsafeExpression()) return this.unsafeExpression();
        break;
      case '(':
        return this.parenthesizedOrTuple();
      case '[':
        return this.collectionExpression();
    }
    if (this.isPredefined(token) || this.isId(token)) return this.predefinedOrName();
    this.error(token, 'CS1525', `Invalid expression term '${token.text}'`);
    return this.missingName();
  },
  predefinedOrName() {
    const token = this.current;
    if (this.isPredefined(token)) return this.n('PredefinedType', this.take());
    if (this.isWord(token, 'from') && this.isQueryStart()) return this.queryExpression();
    if (this.isWord(token, 'var') && this.peek().kind === '(' && this.isDeconstructionAhead()) return this.declarationExpression();
    if (this.peek().kind === '::') {
      this.feature('GlobalNamespace', token);
      const alias = this.n('IdentifierName', this.atWord('global') ? this.takeWord('global') : this.id());
      return this.n('AliasQualifiedName', alias, this.take(), this.simpleName(false));
    }
    return this.simpleName(false);
  }
};
