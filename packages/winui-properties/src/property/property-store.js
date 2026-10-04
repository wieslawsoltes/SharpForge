import {PropertyFault, UnsetValue} from '../dependency-property.js';
import {ChangeNotificationQueue} from '../observable/change-queue.js';
import {defaultPropertyValue, validatePropertyValue} from './validation.js';
import {snapshotPropertyStore, restorePropertyStore} from './store-snapshot.js';
import {propertyValuesEqual} from './value-equality.js';

/** Stable numeric slots, ordered from weakest to strongest. */
export const ValueSource = Object.freeze({
  Default: 0, Inherited: 1, DefaultStyle: 2, StyleSetter: 3, VisualState: 4,
  TemplatedParent: 5, Binding: 6, Local: 7, Animation: 8
});

const defaultInvoke = (callback, args) => callback(...args);
const cloneEntry = entry => ({...entry, slots: new Map(entry.slots), callbacks: new Map(entry.callbacks)});

/** One dependency object's sparse effective-value store; no process-wide state. */
export class PropertyStore {
  #readOnlyKey;

  constructor({registry, ownerType, owner = null, onChange, queue, equals, invoke, maxChanges = 10000, readOnlyKey} = {}) {
    if (!registry || !ownerType) throw new TypeError('PropertyStore requires a registry and owner type');
    this.registry = registry;
    this.ownerType = registry.canonicalType(ownerType);
    this.owner = owner;
    this.onChange = onChange ?? (() => {});
    this.equals = equals ?? ((left, right) => propertyValuesEqual(left, right, registry.services));
    this.invoke = invoke ?? defaultInvoke;
    this.validationServices = {registry, ...registry.services, isAssignable: registry.isAssignable};
    this.ownsQueue = !queue;
    this.queue = queue ?? new ChangeNotificationQueue({maxChanges});
    this.entries = new Map();
    this.creatingDefaults = new Set();
    this.listeners = new Map();
    this.children = new Set();
    this.parent = null;
    this.nextToken = 1;
    this.transactionDepth = 0;
    this.changes = new Map();
    this.disposed = false;
    this.dispatchChange = change => this.deliver(change);
    this.#readOnlyKey = readOnlyKey;
  }

  assertProperty(token, write = false) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'PropertyStore has been disposed');
    const property = this.registry.resolve(token);
    if (!this.registry.applicable(property, this.ownerType)) {
      throw new PropertyFault('ArgumentException', `Property '${property.name}' is not applicable to ${this.ownerType}`);
    }
    if (write && property.readOnly) throw new PropertyFault('InvalidOperationException', 'Property is read-only');
    return property;
  }

  entry(property) {
    let entry = this.entries.get(property.id);
    if (!entry) {
      const metadata = property.metadata;
      const factory = metadata.createDefaultValueCallback ?? metadata.CreateDefaultValueCallback;
      let value = Object.hasOwn(metadata, 'defaultValue') ? metadata.defaultValue : defaultPropertyValue(property.propertyType);
      if (Object.hasOwn(metadata, 'DefaultValue')) value = metadata.DefaultValue;
      if (factory) {
        if (this.creatingDefaults.has(property.id)) throw new PropertyFault('InvalidOperationException', 'Recursive property default factory');
        this.creatingDefaults.add(property.id);
        try { value = this.validateValue(property, this.invoke(factory, []), {coerce: false}); }
        finally { this.creatingDefaults.delete(property.id); }
      }
      entry = {property, slots: new Map(), callbacks: new Map(), defaultValue: value, value, source: ValueSource.Default};
      this.entries.set(property.id, entry);
      this.evaluate(entry);
    }
    return entry;
  }

  /** Get the strongest effective value, creating a factory default at most once. */
  getValue(token) {
    return this.entry(this.assertProperty(token)).value;
  }

  /** Return the local slot, preserving UnsetValue versus a local null. */
  readLocalValue(token) {
    const entry = this.entry(this.assertProperty(token));
    return entry.slots.has(ValueSource.Local) ? entry.slots.get(ValueSource.Local) : UnsetValue;
  }

  /** Return the numeric ValueSource of the current effective value. */
  getValueSource(token) {
    return this.entry(this.assertProperty(token)).source;
  }

  /** Read underneath one overriding slot without changing state or notifying. */
  getBaseValue(token, excludedSource = ValueSource.Animation) {
    const entry = this.entry(this.assertProperty(token));
    this.assertSource(excludedSource);
    let source = ValueSource.Default;
    let value = entry.defaultValue;
    if (entry.property.metadata.inherits && this.parent && excludedSource !== ValueSource.Inherited) {
      const inherited = this.parent.inheritedValue(entry.property);
      if (inherited !== UnsetValue) {
        source = ValueSource.Inherited;
        value = inherited;
      }
    }
    for (const [candidate, candidateValue] of entry.slots) {
      if (candidate !== excludedSource && candidate >= source) {
        source = candidate;
        value = candidateValue;
      }
    }
    return value;
  }

  /** Validate without mutation or change callbacks; coercion can be suppressed for preflight. */
  validateValue(token, value, {coerce = true} = {}) {
    const property = this.assertProperty(token);
    const metadata = property.metadata;
    const services = this.validationServices;
    validatePropertyValue(property, value, services);
    this.registry.validate(property, value);
    const validate = metadata.validateValueCallback ?? metadata.ValidateValueCallback;
    if (validate && this.invoke(validate, [value]) !== true) {
      throw new PropertyFault('ArgumentException', `Validation rejected '${property.name}'`);
    }
    const coercion = metadata.coerceValueCallback ?? metadata.CoerceValueCallback;
    if (coerce && coercion) {
      value = this.invoke(coercion, [this.owner, value]);
      validatePropertyValue(property, value, services);
      this.registry.validate(property, value);
    }
    return value;
  }

  setValue(property, value) {
    return this.setSource(property, ValueSource.Local, value);
  }

  clearValue(property) {
    return this.clearSource(property, ValueSource.Local);
  }

  /** Store one precedence slot; only effective changes notify or reach the host. */
  setSource(token, source, value) {
    const property = this.assertProperty(token, true);
    return this.#writeSource(property, source, value);
  }

  /** Host-only read-only property updates require the capability supplied at construction. */
  setReadOnlyValue(token, value, key, source = ValueSource.Local) {
    if (!this.#readOnlyKey || key !== this.#readOnlyKey) {
      throw new PropertyFault('InvalidOperationException', 'A read-only property update capability is required');
    }
    return this.#writeSource(this.assertProperty(token), source, value);
  }

  #writeSource(property, source, value) {
    this.assertSource(source);
    value = this.validateValue(property, value);
    const entry = this.entry(property);
    if (entry.slots.has(source) && this.equals(entry.slots.get(source), value)) return value;
    const oldValue = entry.value;
    const oldSource = entry.source;
    entry.slots.set(source, value);
    this.evaluate(entry);
    this.changed(entry, oldValue, oldSource);
    return value;
  }

  /** Remove one source and reveal the strongest remaining source. */
  clearSource(token, source) {
    const property = this.assertProperty(token, true);
    this.assertSource(source);
    const entry = this.entry(property);
    if (!entry.slots.has(source)) return entry.value;
    const oldValue = entry.value;
    const oldSource = entry.source;
    entry.slots.delete(source);
    this.evaluate(entry);
    this.changed(entry, oldValue, oldSource);
    return entry.value;
  }

  assertSource(source) {
    if (!Number.isInteger(source) || source < ValueSource.Default || source > ValueSource.Animation) {
      throw new PropertyFault('ArgumentException', 'Unknown dependency-property value source');
    }
  }

  evaluate(entry) {
    let source = ValueSource.Default;
    let value = entry.defaultValue;
    if (entry.property.metadata.inherits && this.parent) {
      const inherited = this.parent.inheritedValue(entry.property);
      if (inherited !== UnsetValue) {
        source = ValueSource.Inherited;
        value = inherited;
      }
    }
    for (const [candidate, candidateValue] of entry.slots) {
      if (candidate >= source) {
        source = candidate;
        value = candidateValue;
      }
    }
    entry.value = value;
    entry.source = source;
  }

  inheritedValue(property) {
    const shared = property.metadata.inheritanceKey;
    if (shared) {
      const candidate = this.registry.lookup(this.ownerType, shared);
      let selected = candidate?.metadata.inheritanceKey === shared ? this.entry(candidate) : null;
      for (const entry of this.entries.values()) {
        if (entry.property.metadata.inheritanceKey === shared && (!selected || entry.source > selected.source)) selected = entry;
      }
      if (selected) return selected.value;
    }
    const entry = this.entries.get(property.id);
    if (entry) return entry.value;
    if (this.registry.applicable(property, this.ownerType)) return this.entry(property).value;
    return this.parent ? this.parent.inheritedValue(property) : UnsetValue;
  }

  changed(entry, oldValue, oldSource) {
    if (this.equals(oldValue, entry.value)) return;
    const change = {property: entry.property, owner: this.owner, oldValue, newValue: entry.value, oldSource, newSource: entry.source};
    if (this.transactionDepth) {
      const previous = this.changes.get(entry.property.id);
      if (previous) Object.assign(previous, {newValue: change.newValue, newSource: change.newSource});
      else this.changes.set(entry.property.id, change);
    } else this.queue.enqueue(entry, this.dispatchChange, change);
  }

  deliver(change) {
    if (this.disposed || this.equals(change.oldValue, change.newValue)) return;
    const property = change.property;
    const entry = this.entries.get(property.id);
    this.onChange(change);
    const callback = property.metadata.propertyChangedCallback ?? property.metadata.PropertyChangedCallback;
    if (callback) this.invoke(callback, [this.owner, change]);
    for (const subscription of [...entry.callbacks.values()]) {
      this.invoke(subscription.callback, subscription.registered ? [this.owner, property] : [change]);
    }
    for (const listener of [...this.listeners.values()]) this.invoke(listener, [change]);
    if (property.metadata.inherits) {
      this.queue.batch(() => {
        for (const child of this.children) child.parentChanged(property);
      });
    }
  }

  parentChanged(property) {
    const shared = property.metadata.inheritanceKey;
    if (shared) {
      const candidate = this.registry.lookup(this.ownerType, shared);
      if (candidate?.metadata.inheritanceKey === shared) property = candidate;
    }
    const entries = shared ? [...this.entries.values()].filter(entry => entry.property.metadata.inheritanceKey === shared)
      : [this.entries.get(property.id)].filter(Boolean);
    let changed = false;
    for (const entry of entries) {
      const oldValue = entry.value;
      const oldSource = entry.source;
      this.evaluate(entry);
      this.changed(entry, oldValue, oldSource);
      changed ||= !this.equals(oldValue, entry.value);
    }
    if (changed || entries.length && entries.every(entry => entry.source > ValueSource.Inherited)) return;
    for (const child of this.children) child.parentChanged(property);
  }

  /** Logical reparenting invalidates inherited values, with cycle/depth checks. */
  setParent(parent) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'PropertyStore has been disposed');
    if (parent === this.parent) return;
    if (parent && (parent.registry !== this.registry || parent.disposed)) {
      throw new PropertyFault('ArgumentException', 'The inheritance parent belongs to another property session');
    }
    let current = parent;
    let depth = 0;
    while (current) {
      if (current === this || ++depth > 1024) throw new PropertyFault('InvalidOperationException', 'Inheritance tree cycle or depth limit');
      current = current.parent;
    }
    this.parent?.children.delete(this);
    this.parent = parent;
    parent?.children.add(this);
    this.queue.batch(() => {
      for (const property of this.registry.propertiesFor(this.ownerType)) {
        if (property.metadata.inherits) this.parentChanged(property);
      }
    });
  }

  /** Register a change listener; the returned disposer is idempotent. */
  subscribe(property, callback) {
    const token = this.addCallback(property, callback, false);
    return () => this.unregisterPropertyChangedCallback(property, token);
  }

  subscribeAll(callback) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'PropertyStore has been disposed');
    if (!callback) throw new PropertyFault('ArgumentNullException', 'A property callback is required');
    if (!Number.isSafeInteger(this.nextToken) || this.listeners.size >= 100000) {
      throw new PropertyFault('InvalidOperationException', 'Callback token space exhausted');
    }
    const token = this.nextToken++;
    this.listeners.set(token, callback);
    return () => this.listeners.delete(token);
  }

  registerPropertyChangedCallback(property, callback) {
    return this.addCallback(property, callback, true);
  }

  addCallback(property, callback, registered) {
    if (!callback) throw new PropertyFault('ArgumentNullException', 'A property callback is required');
    const entry = this.entry(this.assertProperty(property));
    if (!Number.isSafeInteger(this.nextToken) || entry.callbacks.size >= 100000) {
      throw new PropertyFault('InvalidOperationException', 'Callback token space exhausted');
    }
    const token = this.nextToken++;
    entry.callbacks.set(token, {callback, registered});
    return token;
  }

  unregisterPropertyChangedCallback(property, token) {
    if (this.disposed) return;
    this.registry.resolve(property);
    this.entries.get(property.id)?.callbacks.delete(Number(token));
  }

  /** Validate and write a group atomically; notifications run only after a successful commit. */
  transaction(action) {
    const before = new Map([...this.entries].map(([id, entry]) => [id, cloneEntry(entry)]));
    const previousChanges = new Map([...this.changes].map(([id, change]) => [id, {...change}]));
    const previousListeners = new Map(this.listeners);
    const previousToken = this.nextToken;
    this.transactionDepth++;
    let result;
    try {
      result = action();
      if (result?.then) throw new PropertyFault('InvalidOperationException', 'Property transactions must be synchronous');
    } catch (error) {
      this.entries = before;
      this.changes = previousChanges;
      this.listeners = previousListeners;
      this.nextToken = previousToken;
      throw error;
    } finally {
      this.transactionDepth--;
    }
    if (!this.transactionDepth) this.commitChanges();
    return result;
  }

  commitChanges() {
    const changes = [...this.changes.values()];
    this.changes.clear();
    this.queue.batch(() => {
      for (const change of changes) this.queue.enqueue(this.entries.get(change.property.id), this.dispatchChange, change);
    });
  }

  /** Snapshot value and callback state with the host's managed-value encoder. */
  snapshot(options) {
    return snapshotPropertyStore(this, options);
  }

  /** Restore without notifications; callback token identities rewind with values. */
  restore(snapshot, options) {
    return restorePropertyStore(this, snapshot, options);
  }

  /** Managed adapters trace these values only while the owning object is reachable. */
  *retainedValues() {
    for (const entry of this.entries.values()) {
      yield entry.defaultValue;
      yield* entry.slots.values();
      for (const subscription of entry.callbacks.values()) yield subscription.callback;
    }
    yield* this.listeners.values();
  }

  dispose() {
    if (this.disposed) return;
    this.parent?.children.delete(this);
    this.parent = null;
    for (const child of [...this.children]) child.setParent(null);
    this.children.clear();
    this.disposed = true;
    this.entries.clear();
    this.listeners.clear();
    this.changes.clear();
    this.owner = null;
    if (this.ownsQueue) this.queue.dispose();
  }
}
