/** Additive contribution helpers. Existing inherited signatures remain the ABI authority. */
export function familyContractBuilder(registry, eventContracts = new Map()) {
  const { XAML: X, CONTROLS: C } = registry;
  function inherited(owner, category, name) {
    for (let type = registry.types.get(owner); type; type = registry.types.get(type.base)) {
      if (Object.hasOwn(type[category] ?? {}, name)) return true;
    }
    return false;
  }
  function type(name, base = 'object', kind = 'object', constructors = [[]]) {
    if (!registry.types.has(name)) {
      registry.define(name, { base, kind });
      for (const parameters of constructors) registry.ctor(name, parameters);
    }
    return name;
  }
  function property(owner, name, valueType = 'object', value = null, readOnly = false, isStatic = false) {
    if (!inherited(owner, 'properties', name)) registry.prop(owner, name, valueType, value, readOnly, isStatic);
  }
  function method(owner, name, parameters = [], result = 'void', options = {}) {
    const signature = parameters.map(registry.canonicalType);
    if (!(registry.memberIndex.get(owner + '::' + name) ?? []).some(item =>
      item.parameters.length === signature.length && item.parameters.every((value, index) => value === signature[index]))) {
      registry.member(owner, name, parameters, result, options);
    }
  }
  function enumeration(name, values) { if (!registry.types.has(name)) registry.en(name, values); return name; }
  function props(owner, values) {
    for (const [name, value] of Object.entries(values)) property(owner, name, ...(Array.isArray(value) ? value : [value]));
  }
  function event(owner, name, fields = null, { deferral = false } = {}) {
    if (!fields) { if (!inherited(owner, 'events', name)) registry.event(owner, name); return; }
    const prefix = owner.slice(0, owner.lastIndexOf('.') + 1);
    const args = prefix + owner.split('.').at(-1) + name + 'EventArgs';
    const handler = args.replace(/Args$/, 'Handler');
    type(args, X + 'RoutedEventArgs', 'eventArgs'); props(args, fields);
    if (deferral) method(args, 'GetDeferral', [], 'Windows.Foundation.Deferral');
    eventContracts.set(owner + '::' + name, Object.freeze({ owner, event: name, type: args, fields: Object.freeze({ ...fields }), deferral }));
    if (inherited(owner, 'events', name)) return;
    if (!registry.types.has(handler)) registry.delegate(handler, [owner, args]);
    registry.event(owner, name, handler);
  }
  function events(owner, values) { for (const name of values) event(owner, name); }
  function collection(name, element = 'object') {
    type(name, 'object', 'collection'); property(name, 'Count', 'int', 0, true);
    for (const [member, parameters, result] of [['Add', [element], 'void'], ['Insert', ['int', element], 'void'],
      ['Remove', [element], 'bool'], ['RemoveAt', ['int'], 'void'], ['Clear', [], 'void'],
      ['get_Item', ['int'], element], ['IndexOf', [element], 'int']]) method(name, member, parameters, result);
    return name;
  }
  function task(result = 'void') {
    if (result === 'void') return registry.TASK;
    const name = registry.TASK + '`1<' + result + '>';
    type(name, registry.TASK, 'task', []); return name;
  }
  function control(name, base = C + 'Control', values = {}, eventNames = []) {
    const owner = type(C + name, base, 'control'); props(owner, values); events(owner, eventNames); return owner;
  }
  return { registry, X, C, type, property, method, enumeration, props, event, events, collection, task, control };
}
