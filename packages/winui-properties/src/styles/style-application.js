import {ValueSource} from '../property/property-store.js';
import {Style} from './style.js';
import {prepareSetters, transactionStores, materializeSetterResource} from './setter-plan.js';
import {themeResource} from '../resources/reference.js';
import {ResourceFault} from '../resources/errors.js';
import {DisposableScope} from '../object-model/disposable-scope.js';

/** A single control's indexed style subscriptions. No global consumer or heap scan is needed. */
export class StyleApplication {
  constructor({target, store, registry, resources = null, namescope = null, storeFor = () => null,
    bind = null, isBinding = null, materializeResource = null, resolveStyle = value => value}) {
    this.context = {target, store, registry, resources, namescope, storeFor, bind, isBinding, materializeResource, resolveStyle};
    this.layers = new Map();
    this.implicitSubscription = null;
    this.disposed = false;
  }

  setStyle(style) {
    this.implicitSubscription?.();
    this.implicitSubscription = null;
    if (style !== undefined || !this.context.resources) return this.apply(style ?? null);
    const reference = themeResource(this.context.store.ownerType);
    this.implicitSubscription = this.context.resources.observe(reference, {
      allowMissing: true,
      validate: value => this.prepare(value ?? null),
      changed: value => this.apply(value ?? null)
    });
  }

  prepare(style) {
    style = this.context.resolveStyle(style);
    if (style === null) return [];
    if (!(style instanceof Style)) throw new ResourceFault('SFSTYLE013', 'Style value must be a typed Style or null.');
    if (!this.context.registry.isAssignable(style.targetType, this.context.store.ownerType)) {
      throw new ResourceFault('SFSTYLE014', 'Style.TargetType is incompatible with the target control.');
    }
    return prepareSetters(style.compile(this.context.registry).setters, this.context);
  }

  /** Apply a validated layer atomically; local/binding/animation layers remain untouched. */
  apply(style, {source = ValueSource.StyleSetter} = {}) {
    if (this.disposed) throw new ResourceFault('SFSTYLE015', 'The style application is disposed.');
    style = this.context.resolveStyle(style);
    const previous = this.layers.get(source);
    if (previous?.style === style) return false;
    const update = this.prepareUpdate(style, source);
    try {
      update.transaction(() => update.commit());
      update.finalize();
    } catch (error) { update.rollback(); throw error; }
    return true;
  }

  /** Definition mutation preflights every live consumer before any source slot is changed. */
  prepareUpdate(style, source) {
    const previous = this.layers.get(source);
    const entries = this.prepare(style);
    const lifetime = new DisposableScope();
    const previousLifetime = previous?.lifetime.snapshot();
    const changedStores = [...entries, ...(previous?.entries ?? [])].map(entry => entry.store);
    let started = false;
    return {
      transaction: action => transactionStores(changedStores, action),
      commit: () => {
        started = true;
        previous?.lifetime.dispose();
        for (const entry of previous?.entries ?? []) entry.store.clearSource(entry.property, source);
        for (const entry of entries) this.attach(entry, source, lifetime);
        this.observeLegacyDefinition(style, source, lifetime);
        this.layers.set(source, {style, entries, lifetime});
      },
      finalize: () => style?.seal(this.context.registry),
      rollback: () => {
        if (!started) return;
        lifetime.dispose({preserveValues: true, clear: false});
        if (previousLifetime) previous.lifetime.restore(previousLifetime);
        if (previous) this.layers.set(source, previous);
        else this.layers.delete(source);
      }
    };
  }

  observeLegacyDefinition(style, source, lifetime) {
    if (!style?.legacyMutable || style.isSealed) return;
    const listener = {prepare: () => this.prepareUpdate(style, source)};
    const definitions = new Set();
    for (const definition of style.compile(this.context.registry).chain) {
      if (!definition.isSealed) definitions.add(definition);
      for (const setter of definition.setters) if (!setter.isSealed) definitions.add(setter);
    }
    for (const definition of definitions) lifetime.add(definition.subscribe(listener));
  }

  attach(entry, source, lifetime) {
    const {store, property, value} = entry;
    if (entry.binding) {
      lifetime.add(this.context.bind({target: entry.target, store, property, binding: value, source}));
    } else if (entry.reference?.dynamic) {
      lifetime.add(this.context.resources.observe(entry.reference, {
        validate: next => store.validateValue(property, materializeSetterResource(this.context, property, next), {coerce: false}),
        changed: next => store.setSource(property, source, materializeSetterResource(this.context, property, next))
      }));
    } else store.setSource(property, source, value);
  }

  clear(source = ValueSource.StyleSetter) { return this.apply(null, {source}); }
  setDefaultStyle(style) { return this.apply(style, {source: ValueSource.DefaultStyle}); }

  snapshot() {
    return {version: 1, context: {...this.context}, disposed: this.disposed, implicitSubscription: this.implicitSubscription,
      implicitState: this.implicitSubscription?.snapshot?.(),
      layers: [...this.layers].map(([source, layer]) => ({source, style: layer.style, styleState: layer.style?.snapshot(),
        entries: layer.entries.map(entry => ({...entry})), lifetime: layer.lifetime, lifetimeState: layer.lifetime.snapshot()}))};
  }

  /** Store values are restored by the owning runtime first; restore only metadata and saved subscription lifetimes. */
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new TypeError('Invalid StyleApplication snapshot.');
    if (this.implicitSubscription !== snapshot.implicitSubscription) this.implicitSubscription?.();
    for (const layer of this.layers.values()) layer.lifetime.dispose({preserveValues: true, clear: false});
    this.context = snapshot.context;
    this.disposed = snapshot.disposed;
    this.implicitSubscription = snapshot.implicitSubscription;
    if (snapshot.implicitState) this.implicitSubscription?.restore?.(snapshot.implicitState);
    this.layers.clear();
    for (const entry of snapshot.layers) {
      entry.style?.restore(entry.styleState);
      entry.lifetime.restore(entry.lifetimeState);
      this.layers.set(entry.source, {style: entry.style, entries: entry.entries.map(value => ({...value})), lifetime: entry.lifetime});
    }
  }

  *retainedValues() {
    yield this.context?.target;
    for (const layer of this.layers.values()) {
      if (layer.style) yield* layer.style.retainedValues();
      for (const entry of layer.entries) { yield entry.target; yield entry.value; }
      yield* layer.lifetime.retainedValues();
    }
  }

  dispose({preserveValues = false} = {}) {
    if (this.disposed) return;
    this.disposed = true;
    this.implicitSubscription?.();
    this.implicitSubscription = null;
    const failures = [];
    for (const [source, layer] of this.layers) {
      try { layer.lifetime.dispose({preserveValues}); } catch (error) { failures.push(error); }
      if (!preserveValues) {
        for (const entry of layer.entries) {
          try { entry.store.clearSource(entry.property, source); } catch (error) { failures.push(error); }
        }
      }
    }
    this.layers.clear();
    this.context = null;
    if (failures.length) throw new AggregateError(failures, 'Style application disposal failed.');
  }
}
