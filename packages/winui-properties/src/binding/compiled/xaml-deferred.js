import {PropertyFault} from '../../property/values.js';
import {DisposableScope} from '../../object-model/disposable-scope.js';
import {withUIConstruction} from '../../object-model/construction-roots.js';
import {CompiledBindingDefinition} from './compiler.js';
import {DeferredElementScope} from './deferred-elements.js';

/** One deferred declaration owns a factory and live activation, never a hidden preconstructed element. */
export class DeferredXamlElement {
  constructor(specification, services = {}) {
    const {name, context, instantiate, attach, detach} = specification;
    if (!name || typeof instantiate !== 'function' || typeof attach !== 'function' || typeof detach !== 'function'
      || typeof context?.namescope?.registerDeferred !== 'function') {
      throw new PropertyFault('ArgumentException', 'x:Load requires a name, deferred namescope and placement factory');
    }
    this.specification = specification;
    this.services = services;
    this.activations = new Map();
    this.disposed = false;
    this.binding = null;
    this.scope = new DeferredElementScope({
      identity: services.identity,
      withConstruction: action => withUIConstruction(context.writer?.services, action, [specification.parent, context.root]),
      attach: (name, root) => this.attach(root),
      detach: (name, root) => detach(root),
      dispose: root => this.disposeActivation(root), maxNames: 1
    });
    this.unregister = this.scope.register(name, () => this.instantiate());
    this.unreserve = context.namescope.registerDeferred(name, () => this.scope.FindName(name));
    try { this.initializeLoad(specification.load); }
    catch (error) {
      try { this.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Deferred XAML setup failed'); }
      throw error;
    }
  }

  instantiate() {
    const {context, node, instantiate} = this.specification;
    const lifetime = new DisposableScope();
    const activation = {...context, lifetime, afterBuild: [], deferredActivation: node};
    try {
      const root = instantiate(activation);
      if (!root || typeof root !== 'object' || root.then) throw new PropertyFault('InvalidOperationException', 'Deferred XAML requires a synchronous element');
      this.activations.set(root, {lifetime, afterBuild: activation.afterBuild});
      return root;
    } catch (error) {
      try { lifetime.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Deferred XAML construction failed'); }
      throw error;
    }
  }

  attach(root) {
    const activation = this.activations.get(root);
    let attached = false;
    try {
      this.specification.attach(root);
      attached = true;
      for (let index = 0; index < activation.afterBuild.length; index++) {
        if (index >= 100000) throw new PropertyFault('InvalidOperationException', 'Deferred XAML initialization budget exceeded');
        activation.afterBuild[index]();
      }
      activation.afterBuild.length = 0;
    } catch (error) {
      if (attached) {
        try { this.specification.detach(root); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Deferred XAML attachment failed'); }
      }
      throw error;
    }
  }

  initializeLoad(load) {
    if (load === 'true' || load === 'false') load = load === 'true';
    const {context, parent, name} = this.specification;
    if (typeof load === 'boolean') {
      if (load) this.afterBuild(() => { if (!this.disposed) this.scope.setLoad(name, true); });
      return;
    }
    if (!(load instanceof CompiledBindingDefinition)) {
      if (!this.services.compileBinding || load?.kind !== 'MarkupExtension' || !load.name.endsWith(':Bind')) {
        throw new PropertyFault('ArgumentException', 'x:Load accepts a Boolean or a compiled x:Bind expression');
      }
      load = this.services.compileBinding(load, context);
    }
    if (!(load instanceof CompiledBindingDefinition) || !this.services.bind) {
      throw new PropertyFault('NotSupportedException', 'Deferred compiled binding services are unavailable');
    }
    this.binding = this.services.bind({target: parent, property: {kind: 'load', name, type: 'bool'}, binding: load,
      context: {...context, deferredScope: this.scope}});
  }

  afterBuild(action) {
    const callbacks = this.specification.context.afterBuild;
    if (!Array.isArray(callbacks) || callbacks.length >= 100000) throw new PropertyFault('InvalidOperationException', 'XAML initialization budget exceeded');
    callbacks.push(action);
  }

  disposeActivation(root) {
    const activation = this.activations.get(root);
    this.activations.delete(root);
    activation?.lifetime.dispose();
  }

  *retainedValues() {
    yield* this.scope.retainedValues();
    for (const activation of this.activations.values()) yield* activation.lifetime.retainedValues();
    if (this.binding?.retainedValues) yield* this.binding.retainedValues();
  }

  snapshot() {
    return {version: 1, scope: this.scope.snapshot(), disposed: this.disposed, binding: this.binding,
      bindingState: this.binding?.snapshot?.(), activations: [...this.activations].map(([root, entry]) =>
        ({root, entry, state: entry.lifetime.snapshot(), afterBuild: [...entry.afterBuild]}))};
  }

  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.activations) || snapshot.activations.length > 1) {
      throw new TypeError('Invalid deferred XAML snapshot');
    }
    this.scope.restore(snapshot.scope);
    this.disposed = snapshot.disposed;
    this.binding = snapshot.binding;
    if (snapshot.bindingState) this.binding.restore(snapshot.bindingState);
    this.activations = new Map(snapshot.activations.map(({root, entry, state, afterBuild}) => {
      entry.lifetime.restore(state);
      entry.afterBuild = [...afterBuild];
      return [root, entry];
    }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    for (const action of [() => this.binding?.dispose(), () => this.scope.dispose(), () => this.unreserve?.()]) {
      try { action(); } catch (error) { errors.push(error); }
    }
    this.binding = null;
    this.activations.clear();
    if (errors.length) throw new AggregateError(errors, 'Deferred XAML disposal failed');
  }
}

export function createDeferredXamlElement(specification, services) { return new DeferredXamlElement(specification, services); }

/** The host stores this group on the parent; root XAML lifetimes retain only a weak lease. */
export class DeferredXamlOwner {
  constructor({maxElements = 10000} = {}) {
    if (!Number.isSafeInteger(maxElements) || maxElements < 1 || maxElements > 1000000) throw new RangeError('Invalid deferred owner budget');
    this.maxElements = maxElements;
    this.elements = new Set();
    this.disposed = false;
  }
  add(element) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Deferred XAML owner is disposed');
    for (const entry of this.elements) if (entry.disposed) this.elements.delete(entry);
    if (this.elements.size >= this.maxElements) throw new RangeError('Deferred XAML owner budget exceeded');
    this.elements.add(element);
    return new DeferredXamlLease(this, element);
  }
  *retainedValues() { for (const element of this.elements) if (!element.disposed) yield* element.retainedValues(); }
  snapshot() {
    return {version: 1, disposed: this.disposed, elements: [...this.elements].map(element => ({element, state: element.snapshot()}))};
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.elements) || snapshot.elements.length > this.maxElements
      || snapshot.elements.some(entry => !(entry.element instanceof DeferredXamlElement))) throw new TypeError('Invalid deferred owner snapshot');
    this.disposed = snapshot.disposed;
    this.elements = new Set(snapshot.elements.map(entry => entry.element));
    for (const entry of snapshot.elements) entry.element.restore(entry.state);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const errors = [];
    for (const element of this.elements) { try { element.dispose(); } catch (error) { errors.push(error); } }
    this.elements.clear();
    if (errors.length) throw new AggregateError(errors, 'Deferred XAML owner disposal failed');
  }
}

class DeferredXamlLease {
  constructor(owner, element) {
    this.owner = new WeakRef(owner);
    this.element = new WeakRef(element);
    this.disposed = false;
  }
  *retainedValues() {}
  snapshot() { return {version: 1, disposed: this.disposed}; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new TypeError('Invalid deferred XAML lease snapshot');
    this.disposed = snapshot.disposed;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const element = this.element.deref();
    try { element?.dispose(); }
    finally { this.owner.deref()?.elements.delete(element); }
  }
}
