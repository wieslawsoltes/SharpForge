export const RoutingStrategy = Object.freeze({ Direct: 'direct', Bubble: 'bubble', Tunnel: 'tunnel' });

/** Routing is root-scoped. Handled suppresses ordinary listeners without suppressing handled-events-too listeners. */
export class RoutedEventRouter {
  constructor({ parentOf = () => null, contains = () => true, onTarget = () => {}, onDispatch = () => {}, maximumDepth = 512 } = {}) {
    Object.assign(this, { parentOf, contains, onTarget, onDispatch, maximumDepth });
    this.handlers = new Map();
    this.nextOrder = 0;
    this.disposed = false;
  }
  addHandler(id, event, callback, { handledEventsToo = false, order = null } = {}) {
    if (this.disposed) throw new Error('Event router has been disposed');
    if (typeof callback !== 'function') throw new TypeError('Event handler must be a function');
    const ordinal = order ?? this.nextOrder + 1;
    if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new RangeError('Invalid routed event subscription order');
    this.nextOrder = Math.max(this.nextOrder, ordinal);
    if (!this.handlers.has(id)) this.handlers.set(id, new Map());
    const events = this.handlers.get(id);
    if (!events.has(event)) events.set(event, []);
    const list = events.get(event);
    if (list.length >= 1024) throw new RangeError('Routed event handler limit exceeded');
    const entry = { callback, handledEventsToo, order: ordinal };
    list.push(entry);
    list.sort((left, right) => left.order - right.order);
    const dispose = () => {
      const index = list.indexOf(entry);
      if (index >= 0) list.splice(index, 1);
      if (!list.length) events.delete(event);
      if (!events.size) this.handlers.delete(id);
    };
    Object.defineProperty(dispose, 'order', { value: ordinal });
    return dispose;
  }
  path(id) {
    const result = [];
    const visited = new Set();
    while (id != null && this.contains(id)) {
      if (visited.has(id) || result.length >= this.maximumDepth) throw new Error('Invalid routed event ancestry');
      visited.add(id);
      result.push(id);
      id = this.parentOf(id);
    }
    return result;
  }
  prepare(id, name, payload, strategy) {
    if (this.disposed || !this.contains(id)) return null;
    const path = strategy === RoutingStrategy.Direct ? [id] : this.path(id);
    if (strategy === RoutingStrategy.Tunnel) path.reverse();
    const args = { ...payload, OriginalSource: payload.OriginalSource ?? id, Source: id, Handled: !!payload.Handled,
      RoutedEvent: name, Route: [...path] };
    return {path, args};
  }
  raise(id, name, payload = {}, strategy = RoutingStrategy.Bubble) {
    const route = this.prepare(id, name, payload, strategy);
    if (!route) return null;
    const {path, args} = route;
    for (const target of path) {
      args.Source = target;
      for (const entry of [...(this.handlers.get(target)?.get(name) ?? [])]) {
        if (!args.Handled || entry.handledEventsToo) entry.callback(target, args);
      }
      this.onTarget(target, name, args);
    }
    this.onDispatch(id, name, args);
    return args;
  }
  /** Acknowledged input preserves subscription order while managed callbacks reach their first suspension. */
  async raiseAsync(id, name, payload = {}, strategy = RoutingStrategy.Bubble, {signal} = {}) {
    signal?.throwIfAborted();
    const route = this.prepare(id, name, payload, strategy);
    if (!route) throw new Error('The routed event target is no longer active');
    const {path, args} = route;
    const assertActive = target => {
      signal?.throwIfAborted();
      if (this.disposed || !this.contains(id) || !this.contains(target)) throw new Error('The routed event target is no longer active');
    };
    for (const target of path) {
      assertActive(target);
      args.Source = target;
      for (const entry of [...(this.handlers.get(target)?.get(name) ?? [])]) {
        assertActive(target);
        if (!args.Handled || entry.handledEventsToo) await entry.callback(target, args);
      }
      assertActive(target);
      await this.onTarget(target, name, args);
    }
    assertActive(id);
    await this.onDispatch(id, name, args);
    assertActive(id);
    return args;
  }
  removeNode(id) { this.handlers.delete(id); }
  dispose() { this.handlers.clear(); this.disposed = true; }
}
