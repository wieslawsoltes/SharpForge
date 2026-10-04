export function addProperty(registry, owner, name, type, value = null, readOnly = false) {
  if (!registry.types.get(owner)?.properties[name]) registry.prop(owner, name, type, value, readOnly);
}

export function addType(registry, name, options = {}, constructors = [[]]) {
  if (registry.types.has(name)) return;
  registry.define(name, options);
  for (const parameters of constructors) registry.ctor(name, parameters);
}

export function addEvent(registry, owner, name, delegate) {
  if (!registry.types.get(owner)?.events[name]) registry.event(owner, name, delegate);
}

export function addMethod(registry, owner, name, parameters, result = 'void', options = {}) {
  const exists = (registry.memberIndex.get(owner + '::' + name) ?? [])
    .some(member => JSON.stringify(member.parameters) === JSON.stringify(parameters));
  if (!exists) registry.member(owner, name, parameters, result, options);
}

