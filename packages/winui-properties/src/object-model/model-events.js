/** Owner-local event delegates are rooted independently of native subscription closures. */
export class ModelEventHandlers {
  constructor({owner, subscribe, invoke, equals = Object.is}) {
    this.owner = owner; this.subscribe = subscribe; this.invoke = invoke; this.equals = equals; this.entries = [];
  }
  add(handler) {
    if (!handler) throw new TypeError('An event delegate is required.');
    const listener = event => this.invoke(handler, event);
    const owner = this.owner;
    listener.retainedValues = function* () { yield owner; yield handler; };
    const entry = {handler, remove: this.subscribe(listener)};
    this.entries.push(entry);
  }
  remove(handler) {
    for (let index = this.entries.length - 1; index >= 0; index--) {
      if (!this.equals(this.entries[index].handler, handler)) continue;
      this.entries[index].remove(); this.entries.splice(index, 1); return;
    }
  }
  snapshot() { return [...this.entries]; }
  restore(snapshot) {
    const saved = new Set(snapshot);
    for (const entry of this.entries) if (!saved.has(entry)) entry.remove();
    this.entries = [...snapshot];
  }
  *retainedValues() { yield this.owner; for (const entry of this.entries) yield entry.handler; }
  dispose() {
    const entries = this.entries;
    this.entries = [];
    const failures = [];
    for (const entry of entries) {
      try { entry.remove(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'Disposing model event subscriptions failed.');
  }
}

export function registerModelEvent(registry, {owner, name, source, invoke}) {
  for (const adding of [true, false]) {
    registry.register({owner, kind: adding ? 'eventAdd' : 'eventRemove', name: (adding ? 'add_' : 'remove_') + name},
      ({context, receiver, args}) => {
        const list = context.state(receiver, 'modelEvent:' + name, () => new ModelEventHandlers({owner: receiver,
          subscribe: listener => source(context, receiver, listener),
          invoke: (handler, event) => invoke(context, receiver, handler, event), equals: context.delegateEquals ?? context.equals}));
        list[adding ? 'add' : 'remove'](args[0]);
        return null;
      });
  }
}
