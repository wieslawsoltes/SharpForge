import {BindingExpression} from './binding-expression.js';
import {Binding, RelativeSource, RelativeSourceMode} from './binding.js';
import {ValueSource} from '../property/property-store.js';
import {bindingDiagnostic, BindingDiagnosticCode} from './diagnostics.js';

/** App-owned binding table; weak owner keys never turn detached trees into roots. */
export class BindingOperations {
  constructor(services = {}) {
    this.services = services;
    this.maxBindings = services.maxBindings ?? 10000;
    if (!Number.isInteger(this.maxBindings) || this.maxBindings < 1) throw new RangeError('Invalid binding count limit');
    this.targets = new WeakMap();
  }

  SetBinding(store, property, binding, options = {}) {
    try { store.assertProperty(property, true); }
    catch (error) {
      try { this.services.diagnostics?.(bindingDiagnostic(BindingDiagnosticCode.InvalidTarget, {
        targetProperty: property?.name ?? null, message: 'Binding target must be a writable dependency property'
      })); } catch { /* Diagnostic consumers cannot change binding validation behavior. */ }
      throw error;
    }
    let bindings = this.targets.get(store);
    if (!bindings) {
      bindings = new Map();
      this.targets.set(store, bindings);
    }
    if (!bindings.has(property.id) && bindings.size >= this.maxBindings) throw new RangeError('Target binding count limit exceeded');
    const expression = new BindingExpression({store, property, binding, services: this.services, ...options});
    bindings.get(property.id)?.dispose();
    bindings.set(property.id, expression);
    if (expression.sourceSlot === ValueSource.Binding) store.clearValue(property);
    expression.attach();
    this.services.stateChanged?.(store.owner);
    return expression;
  }

  GetBindingExpression(store, property) {
    store.assertProperty(property);
    return this.targets.get(store)?.get(property.id) ?? null;
  }

  ClearBinding(store, property) {
    const bindings = this.targets.get(store);
    const expression = bindings?.get(property.id);
    if (!expression) return;
    expression.dispose();
    bindings.delete(property.id);
    this.services.stateChanged?.(store.owner);
  }

  ClearAllBindings(store, {preserveValues = false} = {}) {
    const bindings = this.targets.get(store);
    if (!bindings) return;
    for (const expression of bindings.values()) expression.dispose({clear: !preserveValues});
    bindings.clear();
    this.targets.delete(store);
    if (!preserveValues) this.services.stateChanged?.(store.owner);
  }

  loaded(store) {
    for (const expression of this.targets.get(store)?.values() ?? []) expression.attach();
  }

  unloaded(store) {
    for (const expression of this.targets.get(store)?.values() ?? []) expression.detach();
  }

  notifyTargetChanged(store, property, value, trigger = 'PropertyChanged') {
    const expression = this.GetBindingExpression(store, property);
    if (!expression) return false;
    expression.notifyTargetChanged(value, trigger);
    return true;
  }

  LostFocus(store) {
    for (const expression of this.targets.get(store)?.values() ?? []) expression.LostFocus();
  }

  *retainedValuesFor(store) {
    for (const expression of this.targets.get(store)?.values() ?? []) yield* expression.retainedValues();
  }

  snapshotFor(store) {
    return {version: 1, entries: [...(this.targets.get(store) ?? [])].map(([id, expression]) => ({id, expression, state: expression.snapshot()}))};
  }

  restoreFor(store, snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > this.maxBindings) {
      throw new TypeError('Invalid BindingOperations snapshot');
    }
    const restored = new Map();
    for (const entry of snapshot.entries) {
      if (!(entry.expression instanceof BindingExpression) || entry.expression.store !== store || restored.has(entry.id)
        || entry.expression.property.id !== entry.id) {
        throw new TypeError('Binding snapshot owner or token mismatch');
      }
      store.assertProperty(entry.expression.property);
      restored.set(entry.id, entry.expression);
    }
    this.services.beginRestore?.();
    try {
      for (const expression of this.targets.get(store)?.values() ?? []) expression.detach();
      this.targets.set(store, restored);
      for (const entry of snapshot.entries) entry.expression.restore(entry.state, this.services);
    } finally { this.services.endRestore?.(); }
  }

  snapshot() { return {version: 1}; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new TypeError('Invalid binding manager snapshot');
  }
}

/** TemplateBinding uses the same engine with a distinct precedence source. */
export function createTemplateBinding({store, property, sourceProperty, owner, ownerStore, services = {}}) {
  const binding = new Binding({
    Path: sourceProperty.name,
    RelativeSource: new RelativeSource(RelativeSourceMode.TemplatedParent)
  });
  const expression = new BindingExpression({
    store,
    property,
    binding,
    source: ValueSource.TemplatedParent,
    services: {
      ...services,
      templatedParent: () => owner,
      read: receiver => receiver === owner ? ownerStore.getValue(sourceProperty) : undefined,
      subscribe: (receiver, step, changed) => ownerStore.subscribe(sourceProperty, changed)
    }
  });
  return expression.attach();
}
