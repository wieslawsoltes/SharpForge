import { Precedence } from '../../lexer/operators.js';
/** C# 7 patterns: `is` type tests, declaration, constant, var and discard patterns. Case labels with patterns are parsed in statements.js. */
const queryWords = new Set(['select', 'where', 'from', 'let', 'join', 'orderby', 'group', 'into', 'on', 'equals', 'by', 'ascending', 'descending']);
const nameKinds = new Set(['IdentifierName', 'GenericName', 'AliasQualifiedName', 'QualifiedName', 'PredefinedType']);
export const basicPatternMethods = {
  /** The right operand of `is`: a type (IsExpression) or a pattern (IsPatternExpression). */
  isExpression(left, keyword) {
    const isToken = this.tokens[this.i - 1];
    if (this.atWord('_') && !this.isDesignationAhead(this.i + 1) && !['(', '{', '.'].includes(this.peek().kind))
      return this.n('IsExpression', left, keyword, this.n('IdentifierName', this.take('IdentifierToken')));
    const recorded = this.features.length,
      pattern = this.pattern(false),
      type =
        pattern.kind === 'TypePattern' ? pattern.children[0] : pattern.kind === 'ConstantPattern' ? this.expressionAsType(pattern.children[0]) : null;
    // A bare type after `is` is the C# 1 type test, not a C# 9 type pattern.
    if (type) {
      for (let k = this.features.length - 1; k >= recorded; k--) if (this.features[k].id === 'TypePattern') this.features.splice(k, 1);
      return this.n('IsExpression', left, keyword, type);
    }
    this.feature('PatternMatching', isToken);
    return this.n('IsPatternExpression', left, keyword, pattern);
  },
  /** Converts a name-like expression (`A.B<C>`) to the equivalent type syntax, or returns null. */
  expressionAsType(expression) {
    if (nameKinds.has(expression.kind)) return expression;
    if (expression.kind !== 'SimpleMemberAccessExpression') return null;
    const [inner, dot, name] = expression.children,
      left = this.expressionAsType(inner);
    return left && left.kind !== 'PredefinedType' ? this.n('QualifiedName', left, dot, name) : null;
  },
  /** An identifier that names a pattern variable (not the pattern combinators, and not `when` inside case labels and switch arms). */
  isDesignationAhead(i = this.i) {
    const token = this.tokens[Math.min(i, this.tokens.length - 1)];
    return (
      this.isId(token) &&
      !this.isWord(token, 'and') &&
      !this.isWord(token, 'or') &&
      !(this.patternWhen && this.isWord(token, 'when')) &&
      !(this.queryDepth > 0 && !token.flags && queryWords.has(token.value))
    );
  },
  primaryPattern() {
    const token = this.current,
      kind = token.kind,
      next = this.peek();
    if (kind === '<' || kind === '<=' || kind === '>' || kind === '>=' || kind === '==' || kind === '!=') return this.relationalPattern();
    if (kind === '(') return this.parenthesizedPattern();
    if (kind === '[') return this.listPattern();
    if (kind === '{') return this.recursivePattern(null);
    if (kind === '..') return this.slicePattern();
    if (this.isWord(token, 'var') && (next.kind === '(' || this.isDesignationAhead(this.i + 1)))
      return this.n('VarPattern', this.takeWord('var'), this.designation());
    if (this.isWord(token, '_') && !['.', '(', '{', '<', '::'].includes(next.kind) && !this.isDesignationAhead(this.i + 1))
      return this.n('DiscardPattern', this.take('UnderscoreToken'));
    // Only directly after `is` can a `?` be the conditional operator (`x is T ? a : b`); in a case label, a switch
    // arm or a subpattern `int?[] items` is a type.
    const info = {},
      mode = (this.patternPrecedence ?? Precedence.Shift) === Precedence.Shift ? 'afterIs' : undefined,
      end = kind === 'await' || (this.isWord(token, 'nameof') && next.kind === '(') ? -1 : this.scanType(this.i, info, mode);
    if (end > this.i) {
      const follower = this.tokens[Math.min(end, this.tokens.length - 1)];
      if (this.isDesignationAhead(end)) return this.n('DeclarationPattern', this.type(mode), this.designation());
      if ((follower.kind === '(' && !info.predefined) || follower.kind === '{') return this.recursivePattern(this.type(mode));
      // An alias-qualified name alone (`global::A.B`) may be a constant, so it is not taken for a type pattern.
      const typeOnly = info.generic || info.predefined || info.suffix || (info.must && !info.alias);
      if (typeOnly && !(info.predefined && this.kindAt(this.i + 1) === '.' && end === this.i + 1)) {
        this.feature('TypePattern', token);
        return this.n('TypePattern', this.type(mode));
      }
    }
    return this.n('ConstantPattern', this.expression(this.patternPrecedence ?? Precedence.Shift));
  }
};
