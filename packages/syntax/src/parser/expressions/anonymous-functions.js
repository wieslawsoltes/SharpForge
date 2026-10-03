/** C# 2 anonymous methods: `delegate (parameters) { }` and the parameterless `delegate { }`, with async and static modifiers. */
export const anonymousFunctionMethods = {
  anonymousMethod(modifiers) {
    const start = this.current, keyword = this.take(); this.feature('AnonDelegates', start);
    const parameters = this.at('(') ? this.parameterList() : null;
    if (!this.at('{')) { this.error(this.current, 'CS1514', '{ expected'); return this.n('AnonymousMethodExpression', modifiers, keyword, parameters, this.n('Block', null, this.missing('{'), null, this.missing('}')), null); }
    return this.n('AnonymousMethodExpression', modifiers, keyword, parameters, this.asyncBody(modifiers, () => this.block()), null);
  }
};
