import {BindingOperations} from './binding-operations.js';
import {createBindingServices} from './context-services.js';

/** Owner-scoped state makes native binding lifetimes visible to managed GC and rewind. */
class TargetBindings {
  constructor(store, operations) {
    this.store = store;
    this.operations = operations;
  }

  retainedValues() { return this.operations.retainedValuesFor(this.store); }
  snapshot() { return this.operations.snapshotFor(this.store); }
  restore(snapshot) { this.operations.restoreFor(this.store, snapshot); }
  dispose(options = {}) {
    this.operations.ClearAllBindings(this.store, {preserveValues: !!(options.preserveValues || options.collected || options.restoring)});
  }
}

export function getBindingOperations(context) {
  return context.state(null, 'propertyBindings', () => {
    return context.styles?.bindingOperations ?? new BindingOperations(createBindingServices(context));
  });
}

export function bindingsFor(context, owner) {
  return context.state(owner, 'bindings', () => new TargetBindings(context.storeFor(owner), getBindingOperations(context)));
}
