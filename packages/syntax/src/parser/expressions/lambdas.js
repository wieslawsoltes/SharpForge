import { Precedence } from '../../lexer/operators.js';
/**
 * C# 3 lambda expressions: `x => e`, `(a, b) => e`, `(int a, ref int b) => { }`, with `async` and `static`
 * modifiers, C# 10 attributes and explicit return types (see csharp10.js). A lambda is recognised by looking ahead
 * for its `=>`, which also separates `(a) => a` from a cast or a parenthesised expression.
 */
const untypedParameterFollowers = new Set([',', ')', '=']);
export const lambdaMethods = {
  /** Parses a lambda or anonymous method when one starts at the cursor, otherwise returns null without consuming. */
  anonymousFunction(min) {
    const attributed = this.at('['),
      afterAttributes = attributed ? this.afterAttributeLists(this.i) : this.i;
    if (afterAttributes < 0) return null;
    const afterModifiers = this.scanLambdaModifiers(afterAttributes),
      token = this.tokens[afterModifiers];
    if (token.kind === 'delegate' && this.kindAt(afterModifiers + 1) !== '*')
      return attributed ? null : this.anonymousMethod(this.lambdaModifiers(afterModifiers));
    if (min > Precedence.Lambda) return null;
    const shape = this.lambdaShape(afterModifiers);
    if (!shape) return null;
    // Roslyn does not check the language version of attributes on a simple lambda (`[A] x => x`), so neither does this.
    const attributeLists = !attributed ? null : shape === 'simple' ? this.attributeLists() : this.lambdaAttributeLists(),
      modifiers = this.lambdaModifiers(afterModifiers);
    if (shape === 'simple') return this.simpleLambda(attributeLists, modifiers);
    return this.parenthesizedLambda(attributeLists, modifiers, shape === 'typed');
  },
  /** The index after the `static` and `async` modifiers at `j`; `async` counts only when a lambda or anonymous method can follow it. */
  scanLambdaModifiers(j) {
    for (;;) {
      const token = this.tokens[j],
        next = this.tokens[Math.min(j + 1, this.tokens.length - 1)];
      if (token.kind === 'static') j++;
      else if (token.kind === 'async' && !token.flags && this.canFollowLambdaAsync(next)) j++;
      else return j;
    }
  },
  canFollowLambdaAsync(next) {
    const kind = next.kind;
    return kind === '(' || kind === 'static' || kind === 'async' || kind === 'delegate' || this.isId(next) || this.isPredefined(next);
  },
  /** What starts at `j`: 'simple' (`x =>`), 'parenthesized' (`(...) =>`), 'typed' (`T (...) =>`) or null for no lambda. */
  lambdaShape(j) {
    const token = this.tokens[j];
    if (this.isId(token) && this.kindAt(j + 1) === '=>') return 'simple';
    if (token.kind === '(') {
      const close = this.matchingBracket(j);
      if (close > 0 && this.kindAt(close + 1) === '=>') return 'parenthesized';
    }
    const open = this.scanType(j);
    if (open <= j || this.kindAt(open) !== '(') return null;
    const close = this.matchingBracket(open);
    if (close < 0 || this.kindAt(close + 1) !== '=>') return null;
    return this.isConditionalBeforeLambda(j, open, close) ? null : 'typed';
  },
  /**
   * `b ? () => 1 : null` could start a lambda that returns `b?`. Roslyn reads the `?` as the conditional operator when
   * a `:` follows the lambda, and as a nullable return type otherwise (`b? () => null`). A predefined type cannot be a
   * condition, so `int? () => null` is always a lambda. `j` starts the type, `open` and `close` are its parentheses.
   */
  isConditionalBeforeLambda(j, open, close) {
    if (this.kindAt(open - 1) !== '?' || this.isPredefined(this.tokens[j])) return false;
    return this.colonsAfter(close + 2) > 0;
  },
  simpleLambda(attributeLists, modifiers) {
    const parameter = this.n('Parameter', null, null, null, this.id(), null),
      arrow = this.lambdaArrow(),
      [body, expression] = this.lambdaBody(modifiers);
    return this.n('SimpleLambdaExpression', attributeLists, modifiers, parameter, arrow, body, expression);
  },
  parenthesizedLambda(attributeLists, modifiers, typed) {
    const returnType = typed ? this.lambdaReturnType() : null,
      open = this.i,
      parameters = this.lambdaParameterList();
    this.discardParameters(open, this.i - 1);
    const arrow = this.lambdaArrow(),
      [body, expression] = this.lambdaBody(modifiers);
    return this.n('ParenthesizedLambdaExpression', attributeLists, modifiers, returnType, parameters, arrow, body, expression);
  },
  /** The `=>` of a lambda, which is where Roslyn reports the lambda feature. */
  lambdaArrow() {
    if (this.at('=>')) this.feature('Lambda', this.current);
    return this.expect('=>');
  },
  /** A block or expression body: returns [block, expression]. The body is its own scope for async and expression variables. */
  lambdaBody(modifiers) {
    const restricted = this.restrictedVariables;
    this.restrictedVariables = false;
    const body = this.asyncBody(modifiers, () => (this.at('{') ? [this.block(), null] : [null, this.expressionOrThrow()]));
    this.restrictedVariables = restricted;
    return body;
  },
  /** Consumes the modifiers up to token index `end`, recording `static` (C# 9) and `async` (C# 5). */
  lambdaModifiers(end) {
    const list = [];
    while (this.i < end) {
      const token = this.current;
      if (token.kind === 'async') {
        // Roslyn reports an async lambda or anonymous method at its `async` modifier.
        this.feature('Async', token);
        list.push(this.takeWord('async'));
        continue;
      }
      if (token.kind === 'static') this.feature('StaticAnonymousFunction', token);
      list.push(this.take());
    }
    return list;
  },
  lambdaParameterList() {
    const open = this.take(),
      parameters = [];
    this.nested(() => {
      if (this.at(')') || this.at('eof')) return;
      // After a comma a parameter is always parsed, so `(a, ) => a` reports the missing one.
      for (;;) {
        const before = this.i;
        parameters.push(this.lambdaParameter());
        if (!this.at(',') || before === this.i) break;
        parameters.push(this.take());
      }
    });
    return this.n('ParameterList', open, parameters, this.expect(')'));
  },
  /** A lambda parameter: a bare name (implicitly typed) or `type name`, with optional attributes, modifiers and default value. */
  lambdaParameter() {
    const attributeLists = this.at('[') ? this.lambdaAttributeLists() : null,
      firstModifier = this.i,
      modifiers = this.isSimpleLambdaScoped() ? [this.takeWord('scoped')] : this.parameterModifiers(),
      afterModifiers = this.i,
      untyped = this.isId() ? untypedParameterFollowers.has(this.peek().kind) : !this.canStartType(),
      type = untyped ? null : this.type(),
      identifier = this.id(),
      equals = this.at('=') ? this.current : null,
      defaultValue = equals ? this.n('EqualsValueClause', this.take(), this.expression()) : null;
    this.lambdaParameterFeatures(firstModifier, afterModifiers, equals);
    if (untyped && afterModifiers > firstModifier && !identifier.isMissing) this.simpleLambdaParameterModifiers(firstModifier);
    return this.n('Parameter', attributeLists, modifiers, type, identifier, defaultValue);
  }
};
