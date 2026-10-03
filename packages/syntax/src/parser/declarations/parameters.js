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
    if (this.at(close) || this.at('eof') || (!this.at(',') && !this.canStartParameter())) return list;
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
    const token = this.current,
      kind = token.kind;
    if (kind === '[' || kind === '(' || kind === '__arglist' || parameterModifiers.has(kind)) return true;
    if (kind === 'delegate') return this.peek().kind === '*';
    return this.isPredefined(token) || this.isId(token);
  },
  parameter() {
    const attributeLists = this.attributeLists(),
      firstModifier = this.i,
      modifiers = this.parameterModifiers(),
      afterModifiers = this.i;
    if (this.at('__arglist')) return this.n('Parameter', attributeLists, modifiers, null, this.take(), null);
    const typeToken = this.current,
      type = this.type(),
      nameToken = this.current,
      identifier = this.id();
    if (modifiers.length) this.paramsCollection(firstModifier, afterModifiers, type);
    if (this.fieldKeyword) this.fieldNamedVariable(nameToken, typeToken, nameToken);
    return this.n('Parameter', attributeLists, modifiers, type, identifier, this.parameterDefault());
  },
  /** The `= value` default of an optional parameter, or null. */
  parameterDefault() {
    if (!this.at('=')) return null;
    this.feature('OptionalParameter', this.current);
    return this.n('EqualsValueClause', this.take(), this.expression());
  }
};
