/** Additive ABI helpers never redefine a released type, property or signature. */
export function resourceContractHelpers(registry) {
  const type = (name, options = {}) => registry.types.has(name) ? registry.types.get(name) : registry.define(name, options);
  const method = (owner, name, parameters, result, options = {}) => {
    const existing = registry.memberIndex.get(owner + '::' + name) ?? [];
    if (existing.some(member => member.parameters.length === parameters.length &&
      member.parameters.every((parameter, index) => parameter === parameters[index]))) return;
    registry.member(owner, name, parameters, result, options);
  };
  const property = (owner, name, valueType, value = null, readOnly = false, isStatic = false) => {
    if (!Object.hasOwn(registry.types.get(owner).properties, name)) registry.prop(owner, name, valueType, value, readOnly, isStatic);
  };
  const constructor = (owner, parameters = []) => method(owner, '.ctor', parameters, owner, {kind: 'constructor'});
  const event = (owner, name, delegate = registry.XAML + 'RoutedEventHandler') => {
    if (!Object.hasOwn(registry.types.get(owner).events, name)) registry.event(owner, name, delegate);
  };
  const collection = (name, element) => {
    type(name, {kind: 'collection', element});
    constructor(name);
    property(name, 'Count', 'int', 0, true);
    for (const [member, parameters, result] of [
      ['Add', [element], 'void'], ['Insert', ['int', element], 'void'], ['Remove', [element], 'bool'],
      ['RemoveAt', ['int'], 'void'], ['Clear', [], 'void'], ['get_Item', ['int'], element]
    ]) method(name, member, parameters, result);
  };
  return {type, method, property, constructor, event, collection};
}
