/** Pure adapter harness; engine-specific boxing, scheduler and GC are covered by integration suites. */
export function managedFamilyContext() {
  const objects = new Map();
  const models = new Map();
  const handlers = new Map();
  const events = [];
  let next = 1;
  const resolve = value => value?.$ref ? objects.get(value.$ref) : value;
  const context = {
    services: {}, events, objects, models,
    allocate(type, fields = {}) {
      const object = { id: next++, type, fields: { ...fields } };
      objects.set(object.id, object);
      return object;
    },
    read(receiver, name) { return resolve(receiver)?.fields[name]; },
    write(receiver, name, value) { resolve(receiver).fields[name] = value; },
    id(value) { return resolve(value)?.id ?? value; },
    typeOf(value) { return resolve(value).type; },
    native(value) {
      const result = resolve(value);
      if (['System.DateTimeOffset', 'System.TimeSpan', 'Windows.UI.Color'].includes(result?.type)) return result.fields;
      return result;
    },
    managed(value) { return value; },
    items(value) { return Array.isArray(value) ? value : resolve(value)?.fields.Items ?? []; },
    collection(values, type) { return context.allocate(type, { Items: [...values] }); },
    collectionVersion() { return 0; },
    state(receiver, key, factory) {
      const identity = context.id(receiver);
      if (!models.has(identity)) models.set(identity, new Map());
      const states = models.get(identity);
      if (!states.has(key) && factory) states.set(key, factory());
      return states.get(key);
    },
    emit(receiver, name, payload) {
      events.push({ receiver, name, payload });
      for (const handler of handlers.get(name) ?? []) handler(receiver, payload);
    },
    on(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    snapshot() {
      return { fields: [...objects].map(([id, value]) => [id, { ...value.fields }]),
        models: [...models].flatMap(([id, states]) => [...states].map(([key, model]) => [id, key, model.snapshot()])) };
    },
    restore(snapshot) {
      for (const [id, fields] of snapshot.fields) objects.get(id).fields = { ...fields };
      for (const [id, key, state] of snapshot.models) models.get(id).get(key).restore(state);
    }
  };
  return context;
}
