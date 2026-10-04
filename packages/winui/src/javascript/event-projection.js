import {contracts, frameworkType, propertiesFor} from '@sharpforge/framework';

class EventMemberPlans {
  constructor() {
    this.owners = new Map();
    this.plans = new Map();
    for (const descriptor of contracts) {
      if (descriptor.isStatic || descriptor.kind === 'constructor') continue;
      const members = this.owners.get(descriptor.owner) ?? [];
      members.push(descriptor);
      this.owners.set(descriptor.owner, members);
    }
  }
  get reconstructible() { return true; }
  get(type) {
    if (this.plans.has(type)) return this.plans.get(type);
    const methods = new Map(), getters = new Map(), setters = new Map(), visited = new Set();
    let owner = type;
    while (owner && !visited.has(owner)) {
      if (visited.size >= 256) throw new RangeError('Event argument type ancestry limit');
      visited.add(owner);
      for (const descriptor of this.owners.get(owner) ?? []) {
        const map = descriptor.kind === 'get' ? getters : descriptor.kind === 'set' ? setters : methods;
        const key = descriptor.kind === 'get' || descriptor.kind === 'set' ? descriptor.property : descriptor.name;
        const list = map.get(key) ?? [];
        if (!list.some(member => member.parameters.length === descriptor.parameters.length)) list.push(descriptor);
        map.set(key, list);
      }
      owner = frameworkType(owner)?.base;
    }
    const plan = {methods, getters, setters, properties: propertiesFor(type)};
    this.plans.set(type, plan);
    return plan;
  }
}

function eventContext(context, receiver, payload, type) {
  const state = new Map([['uiEventPayload', {payload}]]);
  const bound = new Map();
  const overrides = {
    state(owner, name, factory) {
      if (owner !== receiver) return context.state(owner, name, factory);
      if (!state.has(name) && factory) state.set(name, factory());
      return state.get(name);
    },
    typeOf: value => value === receiver ? type : context.typeOf(value),
    read: (owner, name) => owner === receiver ? payload[name] : context.read(owner, name),
    write(owner, name, value) {
      if (owner !== receiver) return context.write(owner, name, value);
      payload[name] = value;
      return value;
    }
  };
  return new Proxy(context, {get(target, name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    if (!bound.has(name)) bound.set(name, value.bind(target));
    return bound.get(name);
  }});
}

/** Ephemeral arguments use registered member adapters without allocating a permanent scene node for every input event. */
export function projectFacadeEventArguments(context, payload, type) {
  const args = {...payload};
  if (!type || !frameworkType(type)) return args;
  const plans = context.state(null, 'facadeEventMemberPlans', () => new EventMemberPlans());
  const plan = plans.get(type);
  const receiver = Object.freeze({eventArguments: type});
  const services = eventContext(context, receiver, payload, type);
  Object.defineProperty(args, 'valueType', {value: type});
  for (const [name, descriptors] of plan.methods) {
    if (descriptors[0].kind !== 'method') continue;
    const fallback = typeof args[name] === 'function' ? args[name] : null;
    args[name] = (...values) => {
      const descriptor = descriptors.find(member => member.parameters.length === values.length);
      if (!descriptor) throw new TypeError('Event argument method arity mismatch');
      const result = context.registry.invoke(services, descriptor, receiver, values);
      if (result.handled) return result.value;
      if (fallback) return fallback(...values);
      throw new TypeError('The event argument member requires an unavailable host service');
    };
  }
  for (const [name, definition] of Object.entries(plan.properties)) {
    if (definition.isStatic) continue;
    const get = plan.getters.get(name)?.[0], set = plan.setters.get(name)?.[0];
    Object.defineProperty(args, name, {enumerable: true, configurable: true,
      get() {
        const result = get && context.registry.invoke(services, get, receiver, []);
        return result?.handled ? result.value : payload[name] ?? definition.value;
      },
      set: definition.readOnly ? undefined : value => {
        const result = set && context.registry.invoke(services, set, receiver, [value]);
        if (!result?.handled) payload[name] = value;
      }
    });
  }
  return args;
}
