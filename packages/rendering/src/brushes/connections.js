import {DrawingModel} from '../media/models.js';

class BrushOwnerLease {
  constructor(connections, owner) {
    this.connections = connections; this.owner = owner; this.values = new Map(); this.models = new Map(); this.active = false;
  }
  retainedValues() { return [...this.values.values()]; }
  set(name, value) {
    const previous = this.values.get(name);
    if (previous === value) return;
    if (this.active && previous) this.connections.release(previous, {model: this.models.get(name)});
    if (value) { this.values.set(name, value); this.models.set(name, this.connections.modelFor(value)); }
    else { this.values.delete(name); this.models.delete(name); }
    if (this.active && value) this.connections.retain(value, {model: this.models.get(name)});
  }
  setActive(active, options = {}) {
    if (this.active === active) return;
    this.active = active;
    for (const [name, value] of this.values) this.connections[active ? 'retain' : 'release'](value, {...options, model: this.models.get(name)});
  }
  snapshot() { return {values: [...this.values], models: [...this.models], active: this.active}; }
  restore(snapshot) {
    this.setActive(false, {silent: true}); this.values = new Map(snapshot.values); this.models = new Map(snapshot.models);
    this.setActive(snapshot.active, {silent: true});
  }
  dispose(options = {}) {
    this.setActive(false, {silent: Boolean(options.preserveValues || options.restoring || options.collected)});
    this.values.clear(); this.models.clear();
  }
}

/** Owner-scoped brush leases avoid an application-to-visual GC edge and invoke connection callbacks once per live brush. */
export function createRenderingBrushConnections(context) {
  const counts = new WeakMap();
  const modelFor = value => {
    const model = value && context.unwrapModel(value);
    return model instanceof DrawingModel && model.renderType.endsWith('.XamlCompositionBrushBase') ? model : null;
  };
  const connections = {
    modelFor,
    lease(owner) { return context.state(owner, 'renderingBrushConnections', () => new BrushOwnerLease(connections, owner)); },
    retain(value, {model = modelFor(value), silent = false} = {}) {
      if (!model) return;
      const count = counts.get(model) ?? 0; counts.set(model, count + 1);
      if (!count && !silent) context.invokeVirtual(value, 'OnConnected()', []);
    },
    release(value, {model = modelFor(value), silent = false} = {}) {
      if (!model) return;
      const count = counts.get(model) ?? 0;
      if (count > 1) counts.set(model, count - 1);
      else if (count) { counts.delete(model); if (!silent) context.invokeVirtual(value, 'OnDisconnected()', []); }
    },
    propertyChanged(change) {
      if (!context.isVisual(change.owner)) return;
      const type = change.property.propertyType ?? change.property.type;
      if (!type?.endsWith('Brush') && !type?.endsWith('XamlCompositionBrushBase')) return;
      connections.lease(change.owner).set(change.property.name, modelFor(change.newValue) ? change.newValue : null);
    },
    attach(owner) {
      if (!context.isVisual(owner)) return;
      const lease = connections.lease(owner);
      for (const [name, definition] of Object.entries(context.propertiesFor(context.typeOf(owner)))) {
        if (definition.type?.endsWith('Brush') || definition.type?.endsWith('XamlCompositionBrushBase')) {
          const value = context.read(owner, name); lease.set(name, modelFor(value) ? value : null);
        }
      }
      lease.setActive(true);
    },
    detach(owner) { context.state(owner, 'renderingBrushConnections')?.setActive(false); }
  };
  return connections;
}
