import { parameterModifiers } from '../modifiers.js';
/**
 * Parameter lists of methods, constructors, delegates, operators, indexers, local functions and anonymous methods:
 * attributes, modifiers (including the C# 3 `this` of extension methods), a type, a name and a C# 4 default value.
 */
export const parameterMethods = {
  parameterList() {
    const open = this.expect('('),
      parameters = this.parameters(')');
    return this.n('ParameterList', open, parameters, this.expect(')'));
  },
  bracketedParameterList() {
    const open = this.expect('['),
      parameters = this.parameters(']');
    return this.n('BracketedParameterList', open, parameters, this.expect(']'));
  },
  /** Parameters up to `close`. After a `,` a parameter is always parsed, so `M(int a, )` reports the missing one. */
  parameters(close) {
    const list = [];
    if (this.at(close) || this.at('eof')) return list;
    for (;;) {
      const before = this.i;
      list.push(this.parameter());
      const comma = this.separator(this.canStartParameter);
      if (!comma || before === this.i) break;
      list.push(comma);
    }
    return list;
  },
  canStartParameter() {
    const token = this.current;
    return token.kind === '[' || token.kind === '__arglist' || parameterModifiers.has(token.kind) || this.isPredefined(token) || this.isId(token);
  },
  parameter() {
    const attributeLists = this.attributeLists(),
      modifiers = this.parameterModifiers();
    if (this.at('__arglist')) return this.n('Parameter', attributeLists, modifiers, null, this.take(), null);
    const type = this.type(),
      identifier = this.id();
    return this.n('Parameter', attributeLists, modifiers, type, identifier, this.parameterDefault());
  },
  /** The `= value` default of an optional parameter, or null. */
  parameterDefault() {
    if (!this.at('=')) return null;
    this.feature('OptionalParameter', this.current);
    return this.n('EqualsValueClause', this.take(), this.expression());
  }
};
