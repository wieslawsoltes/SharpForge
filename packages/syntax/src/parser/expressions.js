import {parseTypedReference} from './typed-references.js';
import { Precedence, binaryOperators, assignmentOperators, prefixOperators } from '../lexer/operators.js';
/** Expression parsing by precedence climbing: assignment, conditional, binary, unary, postfix and primary forms. */
const P = Precedence;
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
    // `ref int () => ref x` is a lambda with a ref return type, not a ref expression.
    const isRef = this.at('ref') && this.lambdaShape(this.i) !== 'typed';
    return isRef ? this.n('RefExpression', this.take(), this.expression()) : this.expression();
  },
  /** Parses an expression whose binary operators all bind at least as tightly as `min`. */
  expression(min = P.Expression) {
    if (!this.enter('Expression nesting limit exceeded')) {
      this.leave();
      this.skip();
      return this.missingName();
    }
    const start = this.i,
      left = this.binary(this.unary(min), min, start);
    this.leave();
    return left;
  },
  /** Extends `left`, whose tokens start at index `start`, with the binary, conditional and assignment operators that bind at least as tightly as `min`. */
  binary(left, min, start) {
    for (;;) {
      const operator = this.operatorAt(),
        text = operator.text,
        operatorToken = this.current;
      if (assignmentOperators[text]) {
        if (min > P.Assignment) break;
        const token = this.takeOperator(operator),
          target = left;
        if (text === '??=') this.feature('CoalesceAssignmentExpression', operatorToken);
        left = this.n(
          assignmentOperators[text],
          left,
          token,
          text === '=' && this.at('ref') ? this.expressionOrRef() : this.expression(P.Assignment)
        );
        if (text === '=' && target.kind === 'TupleExpression') this.mixedDeconstruction(target, start);
        else if (text === '>>>=') this.unsignedRightShiftExpression(start);
        continue;
      }
      if (text === '?') {
        if (min > P.Conditional) break;
        const question = this.take();
        this.colonDepth = (this.colonDepth ?? 0) + 1;
        const whenTrue = this.expressionOrThrow();
        this.colonDepth--;
        left = this.n('ConditionalExpression', left, question, whenTrue, this.expect(':'), this.expressionOrThrow());
        continue;
      }
      if (text === 'switch') {
        if (min > P.Switch) break;
        left = this.switchExpression(left);
        continue;
      }
      if (text === '..') {
        if (min > P.Range) break;
        left = this.rangeExpression(left, start);
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
      const token = this.takeOperator(operator);
      left = this.n(kind, left, token, text === '??' ? this.coalesceOperand(precedence) : this.expression(precedence + 1));
      if (text === '>>>') this.unsignedRightShiftExpression(start);
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
    if (kind === '^') return this.indexExpression();
    if (kind === '..') return this.rangeExpression(null);
    if (Object.hasOwn(prefixOperators, kind)) {
      const operator = this.take();
      return this.n(prefixOperators[kind], operator, this.expression(P.Unary));
    }
    if (kind === 'await' && this.isAwaitExpression()) return this.awaitExpression();
    if (kind === '(' && this.isCast()) {
      const open = this.take(),
        type = this.type(),
        close = this.expect(')');
      return this.n('CastExpression', open, type, close, this.expression(P.Cast));
    }
    if (kind === 'throw') return this.throwExpression(false, min);
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
    if (kind === '[') return this.isCollectionCast(info);
    if (
      kind === 'is' ||
      kind === 'as' ||
      kind === 'switch' ||
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
        '__arglist', '__makeref', '__reftype', '__refvalue'
      ].includes(kind) ||
      this.isPredefined(next)
    );
  },
  postfix(expression, min = P.Expression, binding = false) {
    for (;;) {
      const token = this.current,
        kind = token.kind;
      if (binding && (kind === '++' || kind === '--' || kind === '->' || (kind === '!' && !['.', '[', '(', '?'].includes(this.peek().kind))))
        return expression;
      if (kind === '(') expression = this.n('InvocationExpression', expression, this.argumentList());
      else if (kind === '[') expression = this.n('ElementAccessExpression', expression, this.bracketedArgumentList());
      else if (kind === '.') expression = this.n('SimpleMemberAccessExpression', expression, this.take(), this.simpleName(false));
      else if (kind === '->') expression = this.n('PointerMemberAccessExpression', expression, this.take(), this.simpleName(false));
      else if (kind === '++' || kind === '--')
        expression = this.n(kind === '++' ? 'PostIncrementExpression' : 'PostDecrementExpression', expression, this.take());
      else if (kind === '!' && this.isSuppression()) {
        this.feature('NullableReferenceTypes', token);
        expression = this.n('SuppressNullableWarningExpression', expression, this.take());
      } else if (kind === '?' && this.isConditionalAccess()) expression = this.conditionalAccess(expression, min);
      else return expression;
    }
  },
  primary(min) {
    const token = this.current,
      kind = token.kind;
    if (kind === 'interpolated') return this.interpolatedString();
    const literal = this.literalExpression();
    if (literal) return literal;
    switch (kind) {
      case '__makeref': case '__reftype': case '__refvalue': return parseTypedReference(this);
      case 'default':
        return this.defaultExpression();
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
    this.error(this.errorAnchor(), 'CS1525', `Invalid expression term '${token.text}'`);
    return this.missingName();
  },
  predefinedOrName() {
    const token = this.current;
    if (this.isPredefined(token)) {
      // A predefined type is an expression only as the receiver of a member access (`int.Parse`).
      if (this.peek().kind !== '.') this.error(token, 'CS1525', `Invalid expression term '${token.text}'`);
      return this.n('PredefinedType', this.take());
    }
    if (this.isWord(token, 'from') && this.isQueryStart()) return this.queryExpression();
    if (this.isWord(token, 'var') && this.peek().kind === '(' && this.isDeconstructionAhead()) return this.declarationExpression();
    if (this.peek().kind === '::') {
      this.feature('GlobalNamespace', token);
      const alias = this.n('IdentifierName', this.atWord('global') ? this.takeWord('global') : this.id());
      return this.n('AliasQualifiedName', alias, this.take(), this.simpleName(false));
    }
    if (this.fieldKeyword && this.isFieldExpression()) return this.fieldExpression();
    return this.simpleName(false);
  }
};
