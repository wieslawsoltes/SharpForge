import { Precedence, binaryOperators, assignmentOperators, prefixOperators } from '../lexer/operators.js';
/** Expression parsing by precedence climbing: assignment, conditional, binary, unary, postfix and primary forms. */
const P = Precedence, literalKinds = { NumericLiteralToken: 'NumericLiteralExpression', CharacterLiteralToken: 'CharacterLiteralExpression', TrueKeyword: 'TrueLiteralExpression', FalseKeyword: 'FalseLiteralExpression', NullKeyword: 'NullLiteralExpression', ArgListKeyword: 'ArgListExpression' };
export const expressionMethods = {
  missingName() { return this.n('IdentifierName', this.cache.missing('IdentifierToken')); },
  /** Runs `parse` with the conditional-colon context cleared, as inside brackets a `:` cannot end an outer conditional. */
  nested(parse) { const saved = this.colonDepth; this.colonDepth = 0; try { return parse(); } finally { this.colonDepth = saved; } },
  expressionOrRef() { return this.at('ref') ? this.n('RefExpression', this.take(), this.expression()) : this.expression(); },
  /** Parses an expression whose binary operators all bind at least as tightly as `min`. */
  expression(min = P.Expression) {
    if (!this.enter('Expression nesting limit exceeded')) { this.leave(); this.skip(); return this.missingName(); }
    const left = this.binary(this.unary(min), min); this.leave(); return left;
  },
  binary(left, min) {
    for (;;) {
      const operator = this.operatorAt(), text = operator.text, start = this.current;
      if (assignmentOperators[text]) {
        if (min > P.Assignment) break;
        const token = this.takeOperator(operator); if (text === '??=') this.feature('CoalesceAssignmentExpression', start); else if (text === '>>>=') this.feature('UnsignedRightShift', start, this.tokens[this.i - 1]);
        left = this.n(assignmentOperators[text], left, token, text === '=' && this.at('ref') ? this.expressionOrRef() : this.expression(P.Assignment)); continue;
      }
      if (text === '?') {
        if (min > P.Conditional) break;
        const question = this.take(); this.colonDepth = (this.colonDepth ?? 0) + 1; const whenTrue = this.expressionOrRef(); this.colonDepth--;
        left = this.n('ConditionalExpression', left, question, whenTrue, this.expect(':'), this.expressionOrRef()); continue;
      }
      if (text === 'switch') { if (min > P.Switch) break; left = this.switchExpression(left); continue; }
      if (text === '..') { if (min > P.Range) break; this.feature('RangeOperator', start); const token = this.take(); left = this.n('RangeExpression', left, token, this.canStartExpression() ? this.expression(P.Unary) : null); continue; }
      if (this.atWord('with') && this.peek().kind === '{') { if (min > P.Switch) break; this.feature('Records', start); left = this.n('WithExpression', left, this.takeWord('with'), this.initializerExpression('WithInitializerExpression')); continue; }
      const entry = binaryOperators[text]; if (!entry || entry[0] < min) break;
      const [precedence, kind] = entry;
      if (text === 'is') { left = this.isExpression(left, this.take()); continue; }
      if (text === 'as') { left = this.n('AsExpression', left, this.take(), this.type('afterIs')); continue; }
      if (text === '>>>') this.feature('UnsignedRightShift', start, this.tokens[this.i + operator.count - 1]);
      const token = this.takeOperator(operator);
      left = this.n(kind, left, token, this.expression(text === '??' ? precedence : precedence + 1));
    }
    return left;
  },
  unary(min) {
    const token = this.current, kind = token.kind;
    if (min <= P.Lambda || kind === 'delegate' || kind === 'static' || kind === 'async') { const lambda = this.anonymousFunction(min); if (lambda) return lambda; }
    if (Object.hasOwn(prefixOperators, kind)) {
      if (kind === '^') this.feature('IndexOperator', token);
      const operator = this.take(); return this.n(prefixOperators[kind], operator, this.expression(P.Unary));
    }
    if (kind === '..') { this.feature('RangeOperator', token); const operator = this.take(); return this.n('RangeExpression', null, operator, this.canStartExpression() ? this.expression(P.Unary) : null); }
    if (kind === 'await' && this.canStartExpression(this.peek()) && this.peek().kind !== '[') { this.feature('Async', token); return this.n('AwaitExpression', this.takeWord('await'), this.expression(P.Unary)); }
    if (kind === '(' && this.isCast()) { const open = this.take(), type = this.type(), close = this.expect(')'); return this.n('CastExpression', open, type, close, this.expression(P.Cast)); }
    if (kind === 'throw') { this.feature('ThrowExpression', token); return this.n('ThrowExpression', this.take(), this.expression(P.Coalescing)); }
    if (kind === 'ref') return this.n('RefExpression', this.take(), this.expression());
    return this.postfix(this.primary(min), min);
  },
  /** The cast rule of the specification: `(T)` is a cast when T must be a type or the following token can only start an operand. */
  isCast() {
    const info = {}, end = this.scanType(this.i + 1, info);
    if (end < 0 || this.kindAt(end) !== ')') return false;
    if (info.must) return true;
    const next = this.tokens[Math.min(end + 1, this.tokens.length - 1)], kind = next.kind;
    if (kind === 'is' || kind === 'as' || kind === 'switch' || kind === '[' || kind === 'await' && !this.canStartExpression(this.tokens[Math.min(end + 2, this.tokens.length - 1)])) return false;
    return this.isId(next) || ['integer', 'double', 'string', 'char', 'interpolated', '(', '!', '~', 'true', 'false', 'null', 'this', 'base', 'new', 'typeof', 'sizeof', 'default', 'checked', 'unchecked', 'delegate', 'throw', 'stackalloc', 'ref', '__arglist'].includes(kind) || this.isPredefined(next);
  },
  postfix(expression, min = P.Expression, binding = false) {
    for (;;) {
      const token = this.current, kind = token.kind;
      if (binding && (kind === '++' || kind === '--' || kind === '!' && !['.', '[', '(', '?'].includes(this.peek().kind))) return expression;
      if (kind === '(') expression = this.n('InvocationExpression', expression, this.argumentList());
      else if (kind === '[') expression = this.n('ElementAccessExpression', expression, this.bracketedArgumentList());
      else if (kind === '.') expression = this.n('SimpleMemberAccessExpression', expression, this.take(), this.simpleName(false));
      else if (kind === '->') expression = this.n('PointerMemberAccessExpression', expression, this.take(), this.simpleName(false));
      else if (kind === '++' || kind === '--') expression = this.n(kind === '++' ? 'PostIncrementExpression' : 'PostDecrementExpression', expression, this.take());
      else if (kind === '!' && this.isSuppression()) { this.feature('NullableReferenceTypes', token); expression = this.n('SuppressNullableWarningExpression', expression, this.take()); }
      else if (kind === '?' && this.isConditionalAccess()) { this.feature('NullPropagatingOperator', token); expression = this.n('ConditionalAccessExpression', expression, this.take(), this.conditionalAccessTail(min)); }
      else return expression;
    }
  },
  argumentList() { const open = this.expect('('), args = this.nested(() => this.arguments(')')); return this.n('ArgumentList', open, args, this.expect(')')); },
  bracketedArgumentList() { const open = this.expect('['), args = this.nested(() => this.arguments(']')); return this.n('BracketedArgumentList', open, args, this.expect(']')); },
  arguments(close) {
    const list = [];
    while (!this.at(close) && !this.at('eof')) {
      const before = this.i; list.push(this.argument());
      if (this.at(',')) list.push(this.take()); else break; if (before === this.i) break;
    }
    return list;
  },
  /** One argument or tuple element: optional `name:`, optional ref/out/in, then an expression or declaration expression. */
  argument() {
    let nameColon = null, refKind = null;
    if (this.isId() && this.peek().kind === ':') { this.feature('NamedArgument', this.current); nameColon = this.n('NameColon', this.n('IdentifierName', this.id()), this.take()); }
    if (this.atAny(['ref', 'out', 'in'])) refKind = this.take();
    const declares = refKind?.kind === 'OutKeyword' || (this.declarationContext ?? 0) > 0 || this.tupleContext;
    if (refKind?.kind === 'OutKeyword' && this.isDeclarationExpressionAhead()) this.feature('OutVar', this.current);
    return this.n('Argument', nameColon, refKind, declares && this.isDeclarationExpressionAhead() ? this.declarationExpression() : this.expression());
  },
  primary(min) {
    const token = this.current, kind = token.kind;
    if (kind === 'interpolated') return this.interpolatedString();
    if (Object.hasOwn(literalKinds, token.syntaxKind)) return this.n(literalKinds[token.syntaxKind], this.take());
    if (token.syntaxKind.endsWith('StringLiteralToken')) return this.n(token.flags?.utf8 ? 'Utf8StringLiteralExpression' : 'StringLiteralExpression', this.take());
    switch (kind) {
      case 'default': if (this.peek().kind === '(') { this.feature('Default', token); return this.n('DefaultExpression', this.take(), this.take(), this.type(), this.expect(')')); } this.feature('DefaultLiteral', token); return this.n('DefaultLiteralExpression', this.take());
      case 'typeof': return this.n('TypeOfExpression', this.take(), this.expect('('), this.type(), this.expect(')'));
      case 'sizeof': return this.n('SizeOfExpression', this.take(), this.expect('('), this.type(), this.expect(')'));
      case 'checked': case 'unchecked': { const keyword = this.take(), open = this.expect('('), expression = this.nested(() => this.expression()); return this.n(kind === 'checked' ? 'CheckedExpression' : 'UncheckedExpression', keyword, open, expression, this.expect(')')); }
      case 'this': return this.n('ThisExpression', this.take());
      case 'base': return this.n('BaseExpression', this.take());
      case 'new': return this.newExpression();
      case 'stackalloc': return this.stackAllocExpression();
      case '(': return this.parenthesizedOrTuple();
      case '[': return this.collectionExpression();
    }
    if (this.isPredefined(token) || this.isId(token)) return this.predefinedOrName();
    this.error(token, 'CS1525', `Invalid expression term '${token.text}'`); return this.missingName();
  },
  predefinedOrName() {
    const token = this.current;
    if (this.isPredefined(token)) return this.n('PredefinedType', this.take());
    if (this.isWord(token, 'from') && this.isQueryStart()) return this.queryExpression();
    if (this.isWord(token, 'var') && this.peek().kind === '(' && this.isDeconstructionAhead()) return this.declarationExpression();
    if (this.peek().kind === '::') { this.feature('GlobalNamespace', token); const alias = this.n('IdentifierName', this.atWord('global') ? this.takeWord('global') : this.id()); return this.n('AliasQualifiedName', alias, this.take(), this.simpleName(false)); }
    return this.simpleName(false);
  },
  newExpression() {
    const start = this.current, keyword = this.take();
    if (this.at('(') && !(this.scanTupleType(this.i) >= 0 && ['[', '?'].includes(this.kindAt(this.scanTupleType(this.i))))) { this.feature('ImplicitObjectCreation', start); return this.n('ImplicitObjectCreationExpression', keyword, this.argumentList(), this.at('{') ? this.objectOrCollectionInitializer() : null); }
    if (this.at('{')) {
      this.feature('AnonymousTypes', start); const open = this.take(), list = [];
      this.nested(() => { while (!this.at('}') && !this.at('eof')) {
        const before = this.i, nameEquals = this.isId() && this.peek().kind === '=' ? this.n('NameEquals', this.n('IdentifierName', this.id()), this.take()) : null;
        list.push(this.n('AnonymousObjectMemberDeclarator', nameEquals, this.expression())); if (this.at(',')) list.push(this.take()); else break; if (before === this.i) break;
      } });
      return this.n('AnonymousObjectCreationExpression', keyword, open, list, this.expect('}'));
    }
    if (this.at('[')) {
      this.feature('ImplicitArray', start); const open = this.take(), commas = []; while (this.at(',')) commas.push(this.take());
      const close = this.expect(']'); return this.n('ImplicitArrayCreationExpression', keyword, open, commas, close, this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : this.n('ArrayInitializerExpression', this.expect('{'), null, this.cache.missing('CloseBraceToken')));
    }
    const type = this.type('new');
    if (type.kind === 'ArrayType') return this.n('ArrayCreationExpression', keyword, type, this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : null);
    const args = this.at('(') ? this.argumentList() : null, initializer = this.at('{') ? this.objectOrCollectionInitializer() : null;
    if (!args && !initializer) this.error(this.current, 'CS1526', 'A new expression requires an argument list or (), [], or {} after type');
    return this.n('ObjectCreationExpression', keyword, type, args, initializer);
  },
  stackAllocExpression() {
    const keyword = this.take();
    if (this.at('[') && this.peek().kind === ']') { this.feature('StackAllocInitializer', this.current); return this.n('ImplicitStackAllocArrayCreationExpression', keyword, this.take(), this.take(), this.initializerExpression('ArrayInitializerExpression')); }
    const type = this.type('new'); if (this.at('{')) this.feature('StackAllocInitializer', this.current);
    return this.n('StackAllocArrayCreationExpression', keyword, type, this.at('{') ? this.initializerExpression('ArrayInitializerExpression') : null);
  },
  /** `{ a, b }` initializers. Array initializers nest; `with` and object initializers hold assignments. */
  initializerExpression(kind) {
    const open = this.expect('{'), list = [];
    this.nested(() => { while (!this.at('}') && !this.at('eof')) {
      const before = this.i;
      if (kind === 'ArrayInitializerExpression') list.push(this.variableInitializer());
      else if (kind === 'ObjectInitializerExpression' || kind === 'WithInitializerExpression') list.push(this.memberInitializer());
      else list.push(this.at('{') ? this.initializerExpression('ComplexElementInitializerExpression') : this.expression());
      if (this.at(',')) list.push(this.take()); else break; if (before === this.i) break;
    } });
    return this.n(kind, open, list, this.expect('}'));
  },
  memberInitializer() {
    const start = this.current; let target;
    if (this.at('[')) { this.feature('DictionaryInitializer', start); target = this.n('ImplicitElementAccess', this.bracketedArgumentList()); }
    else if (this.isId() && this.peek().kind === '=') target = this.n('IdentifierName', this.id());
    else return this.expression();
    const equals = this.expect('='), value = this.at('{') ? this.objectOrCollectionInitializer() : this.expression();
    return this.n('SimpleAssignmentExpression', target, equals, value);
  },
  objectOrCollectionInitializer() {
    const next = this.peek(), object = next.kind === '}' || next.kind === '[' && this.kindAt(this.matchingBracket(this.i + 1) + 1) === '=' || this.isId(next) && this.kindAt(this.i + 2) === '=';
    this.feature(object ? 'ObjectInitializer' : 'CollectionInitializer', this.current);
    return this.initializerExpression(object ? 'ObjectInitializerExpression' : 'CollectionInitializerExpression');
  },
  collectionExpression() {
    const start = this.current, open = this.take(), elements = []; this.feature('CollectionExpressions', start);
    this.nested(() => { while (!this.at(']') && !this.at('eof')) {
      const before = this.i;
      if (this.at('..')) elements.push(this.n('SpreadElement', this.take(), this.expression()));
      else if (this.atWord('with') && this.peek().kind === '(' && !elements.length) { this.feature('CollectionExpressionArguments', this.current); elements.push(this.n('WithElement', this.takeWord('with'), this.argumentList())); }
      else elements.push(this.n('ExpressionElement', this.expression()));
      if (this.at(',')) elements.push(this.take()); else break; if (before === this.i) break;
    } });
    return this.n('CollectionExpression', open, elements, this.expect(']'));
  },
  switchExpression(governing) {
    const start = this.current, keyword = this.take(), open = this.expect('{'), arms = []; this.feature('SwitchExpression', start);
    this.nested(() => { while (!this.at('}') && !this.at('eof')) {
      const before = this.i, pattern = this.pattern(true), when = this.atWord('when') ? this.n('WhenClause', this.takeWord('when'), this.expression()) : null;
      arms.push(this.n('SwitchExpressionArm', pattern, when, this.expect('=>'), this.expression()));
      if (this.at(',')) arms.push(this.take()); else break; if (before === this.i) break;
    } });
    return this.n('SwitchExpression', governing, keyword, open, arms, this.expect('}'));
  },
  /** Expands a scanned interpolated-string token into InterpolatedStringExpression, parsing each hole with a nested parser. */
  interpolatedString() {
    const token = this.current, s = token.structure, text = this.source.text, cache = this.cache, slice = (a, b) => text.slice(a, b); this.i++;
    const raw = s.raw, startKind = raw ? (s.multiline ? 'InterpolatedMultiLineRawStringStartToken' : 'InterpolatedSingleLineRawStringStartToken') : s.verbatim ? 'InterpolatedVerbatimStringStartToken' : 'InterpolatedStringStartToken';
    this.feature('InterpolatedStrings', token);
    const start = cache.token(startKind, slice(s.start, s.startEnd), undefined, this.leadingWithSkipped(token.leadingTrivia)), contents = [];
    const sub = (tokens, tail, end) => {
      const eof = Object.freeze({ kind: 'eof', syntaxKind: 'EndOfFileToken', text: '', value: undefined, start: end, end, fullStart: end, leadingTrivia: tail, trailingTrivia: Object.freeze([]) });
      const child = new this.constructor({ source: this.source, tokens: [...tokens, eof], diagnostics: [], features: [] }, { greenCache: cache, inAsync: this.inAsync }); child.depth = this.depth;
      const expression = child.expression(); if (!child.at('eof')) { child.error(child.current, 'CS1003', 'Unexpected trailing interpolation input'); child.skipRest(); }
      for (const d of child.diagnostics) if (this.diagnostics.length < 200) this.diagnostics.push(d);
      this.features.push(...child.features); this.nodeCount += child.nodeCount;
      return [expression, child.leadingWithSkipped(tail)];
    };
    for (const segment of s.segments) {
      if (segment.type === 'text') { contents.push(this.n('InterpolatedStringText', cache.token('InterpolatedStringTextToken', slice(segment.start, segment.end), segment.value))); continue; }
      const open = cache.token('OpenBraceToken', slice(segment.open.start, segment.open.end), undefined, Object.freeze([]), this.trivia(segment.head)); let [expression, pending] = sub(segment.tokens, segment.tail, segment.exprEnd), alignment = null, format = null;
      if (segment.comma >= 0) { const comma = cache.token('CommaToken', ',', undefined, pending, this.trivia(segment.alignHead)); let value; [value, pending] = sub(segment.alignTokens, segment.alignTail, segment.alignEnd); alignment = this.n('InterpolationAlignmentClause', comma, value); }
      if (segment.colon >= 0) { format = this.n('InterpolationFormatClause', cache.token('ColonToken', ':', undefined, pending), cache.token('InterpolatedStringTextToken', slice(segment.formatStart, segment.formatEnd), segment.formatValue)); pending = Object.freeze([]); }
      const close = segment.close ? cache.token('CloseBraceToken', slice(segment.close.start, segment.close.end), undefined, pending) : cache.missing('CloseBraceToken', pending);
      contents.push(this.n('Interpolation', open, expression, alignment, format, close));
    }
    const trailing = this.trivia(token.trailingTrivia), endKind = raw ? 'InterpolatedRawStringEndToken' : 'InterpolatedStringEndToken';
    const end = s.closed ? cache.token(endKind, slice(s.endStart, s.end), undefined, Object.freeze([]), trailing) : new start.constructor(endKind, '', undefined, Object.freeze([]), trailing, 1);
    return this.n('InterpolatedStringExpression', start, contents, end);
  }
};
