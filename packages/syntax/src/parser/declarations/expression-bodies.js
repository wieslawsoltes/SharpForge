/**
 * Member bodies: a block, a C# 6 expression body (`=> e;`) or a bare semicolon, and C# 6 auto-property initializers.
 * The feature recorded for an expression body depends on the member: methods, properties, indexers and operators
 * are C# 6; accessors, constructors and destructors are C# 7.
 */
export const expressionBodyMethods = {
  /** `=> expression` (or `=> ref expression`). `feature` is the catalog id recorded at the arrow, if any. */
  arrowExpressionClause(feature) {
    if (feature) this.feature(feature, this.current);
    const arrow = this.take();
    return this.n('ArrowExpressionClause', arrow, this.expressionOrThrow());
  },
  /**
   * A block body, an expression body or a bare semicolon: returns [body, expressionBody, semicolonToken]. Roslyn keeps
   * both bodies when a block is followed by `=>` (the binder reports CS8057), so both are returned then.
   */
  functionBody(feature) {
    const body = this.at('{') ? this.block() : null,
      expressionBody = this.at('=>') ? this.arrowExpressionClause(feature) : null;
    return [body, expressionBody, body && !expressionBody ? this.match(';') : this.expect(';')];
  },
  /** What follows a property's accessor list or name: returns [expressionBody, initializer, semicolonToken]. */
  propertyTail() {
    if (this.at('=>')) return [this.arrowExpressionClause('ExpressionBodiedProperty'), null, this.expect(';')];
    if (this.at('=')) {
      this.feature('AutoPropertyInitializer', this.current);
      const initializer = this.n('EqualsValueClause', this.take(), this.inInitializer(this.variableInitializer));
      return [null, initializer, this.expect(';')];
    }
    return [null, null, this.match(';')];
  }
};
