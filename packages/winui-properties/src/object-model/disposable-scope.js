/** An explicit lifetime for event handlers, bindings and template-created resources. */
export class DisposableScope {
  constructor() {
    this.disposed = false;
    this.actions = [];
    this.resources = [];
  }

  add(disposable) {
    const action = typeof disposable === 'function' ? disposable : options => disposable.dispose(options);
    if (this.disposed) action();
    else {
      this.actions.push(action);
      this.resources.push(disposable);
    }
    return disposable;
  }

  dispose(options) {
    if (this.disposed) return;
    this.disposed = true;
    const failures = [];
    for (let index = this.actions.length - 1; index >= 0; index--) {
      try {
        this.actions[index](options);
      } catch (error) {
        failures.push(error);
      }
    }
    this.actions.length = 0;
    this.resources.length = 0;
    if (failures.length) throw new AggregateError(failures, 'Disposing the object lifetime failed.');
  }

  snapshot() {
    return {disposed: this.disposed, actions: [...this.actions], resources: [...this.resources],
      states: this.resources.map(resource => typeof resource.snapshot === 'function' ? resource.snapshot() : null)};
  }

  restore(snapshot) {
    this.disposed = snapshot.disposed;
    this.actions = [...snapshot.actions];
    this.resources = [...snapshot.resources];
    for (let index = 0; index < this.resources.length; index++) {
      if (snapshot.states[index] !== null) this.resources[index].restore?.(snapshot.states[index]);
    }
  }

  *retainedValues() {
    for (const resource of this.resources) if (resource?.retainedValues) yield* resource.retainedValues();
  }
}
