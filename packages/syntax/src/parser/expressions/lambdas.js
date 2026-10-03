import { Precedence } from '../../lexer/operators.js';
/** Lambda expressions: implicit and explicit parameter lists, expression and block bodies, static/async modifiers and C# 10 return types. */
export const lambdaMethods = {
  /**
   * Parses a lambda or anonymous method when one starts at the cursor, otherwise returns null without consuming.
   * `(...) =>` is recognised by scanning to the matching parenthesis, which also separates lambdas from casts and parenthesised expressions.
   */
  anonymousFunction(min) {
    let j = this.i;
    for (;;) {
      const token = this.tokens[j], next = this.tokens[Math.min(j + 1, this.tokens.length - 1)];
      if (token.kind === 'static' || token.kind === 'async' && !token.flags && (next.kind === '(' || next.kind === 'static' || next.kind === 'async' || next.kind === 'delegate' || this.isId(next) || this.isPredefined(next))) j++; else break;
    }
    const token = this.tokens[j];
    if (token.kind === 'delegate' && this.kindAt(j + 1) !== '*') return this.anonymousMethod(this.lambdaModifiers(j));
    if (min > Precedence.Lambda) return null;
    let returnTypeEnd = -1;
    if (this.isId(token) && this.kindAt(j + 1) === '=>') { /* simple lambda */ }
    else if (token.kind === '(' && this.kindAt(this.matchingBracket(j) + 1) === '=>' && this.matchingBracket(j) > 0) { /* parenthesised lambda */ }
    else {
      returnTypeEnd = this.scanType(j);
      if (returnTypeEnd <= j || this.kindAt(returnTypeEnd) !== '(' || this.matchingBracket(returnTypeEnd) < 0 || this.kindAt(this.matchingBracket(returnTypeEnd) + 1) !== '=>') return null;
    }
    const start = this.current, modifiers = this.lambdaModifiers(j); this.feature('Lambda', start);
    if (modifiers.some(m => m.kind === 'StaticKeyword')) this.feature('StaticAnonymousFunction', start);
    if (returnTypeEnd < 0 && this.isId()) {
      const parameter = this.n('Parameter', null, null, null, this.id(), null), arrow = this.take(), [body, expression] = this.asyncBody(modifiers, () => this.at('{') ? [this.block(), null] : [null, this.expressionOrRef()]);
      return this.n('SimpleLambdaExpression', null, modifiers, parameter, arrow, body, expression);
    }
    const returnType = returnTypeEnd >= 0 ? this.type() : null; if (returnType) this.feature('LambdaReturnType', start);
    const parameters = this.lambdaParameterList(), arrow = this.expect('=>'), [body, expression] = this.asyncBody(modifiers, () => this.at('{') ? [this.block(), null] : [null, this.expressionOrRef()]);
    return this.n('ParenthesizedLambdaExpression', null, modifiers, returnType, parameters, arrow, body, expression);
  },
  lambdaModifiers(end) { const list = []; while (this.i < end) list.push(this.at('async') ? this.takeWord('async') : this.take()); if (list.some(m => m.kind === 'AsyncKeyword')) this.feature('Async', this.tokens[end]); return list; },
  lambdaParameterList() {
    const open = this.take(), parameters = [];
    this.nested(() => { while (!this.at(')') && !this.at('eof')) {
      const before = this.i, attributeLists = this.at('[') ? this.attributeLists() : null, modifiers = this.parameterModifiers();
      if (this.isId() && [',', ')', '='].includes(this.peek().kind)) parameters.push(this.n('Parameter', attributeLists, modifiers, null, this.id(), this.at('=') ? this.n('EqualsValueClause', this.take(), this.expression()) : null));
      else { const type = this.type(), identifier = this.id(); parameters.push(this.n('Parameter', attributeLists, modifiers, type, identifier, this.at('=') ? this.n('EqualsValueClause', this.take(), this.expression()) : null)); }
      if (this.at(',')) parameters.push(this.take()); else break; if (before === this.i) break;
    } });
    return this.n('ParameterList', open, parameters, this.expect(')'));
  }
};
