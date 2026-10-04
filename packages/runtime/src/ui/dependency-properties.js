import {
  DependencyPropertyRegistry, PropertyStore, ValueSource, UnsetValue, validatePropertyValue, propertyValuesEqual
} from '@sharpforge/winui-properties';
import {canonicalType, frameworkType, frameworkAssignable, propertiesFor, XAML} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {invokeManagedCallback} from './callbacks.js';
import {nativePropertyValue, managedPropertyValue, managedPropertyChange} from './property-values.js';

const identity = reference => `${reference.h}:${reference.g}`;
const inherited = new Set(['DataContext', 'FlowDirection', 'Language', 'FontFamily', 'FontSize', 'Foreground']);
const equals = propertyValuesEqual;

/** Bridge sparse property values to precise managed heap edges and the scene command stream. */
export class ManagedPropertyServices {
  #readOnlyKey = Object.freeze({});

  constructor(platform) {
    this.platform = platform;
    this.stores = new Map();
    this.tokens = new Map();
    this.tokenDefinitions = new Map();
    this.registry = new DependencyPropertyRegistry({
      canonicalType,
      baseType: type => platform.heap.methodTables.get(type).base?.name,
      isAssignable: (target, source) => this.assignable(target, source),
      getDeclaredProperty: (type, name) => this.descriptor(type, name),
      typeDefinition: frameworkType,
      typeOf: value => isReference(value) ? platform.heap.get(value).type : value?.valueType,
      validate: (property, value) => validatePropertyValue(property, value, {
        registry: this.registry,
        typeDefinition: frameworkType,
        typeOf: item => isReference(item) ? platform.heap.get(item).type : item?.valueType,
        isAssignable: (target, source) => this.assignable(target, source)
      })
    });
  }

  userType(name) {
    return this.platform.vm.image?.types?.find(type => type.name === name)
      ?? this.platform.vm.inspector?.types?.find(type => type.name === name);
  }

  assignable(target, source) {
    const seen = new Set();
    while (source && !seen.has(source) && seen.size < 256) {
      if (frameworkAssignable(target, source)) return true;
      seen.add(source);
      source = this.platform.heap.methodTables.get(source).base?.name;
    }
    return false;
  }

  descriptor(type, name) {
    const descriptor = frameworkType(type)?.properties[name];
    if (!descriptor) return null;
    return {...descriptor, metadata: {inherits: inherited.has(name),
      inheritanceKey: inherited.has(name) ? name : null, ...descriptor.metadata}};
  }

  lookup(reference, name) {
    const property = this.registry.lookup(this.platform.record(reference).type, name);
    if (!property) throw new ManagedFault('ArgumentException', `Unknown dependency property '${name}'`);
    return property;
  }

  token(owner, name) {
    const property = this.registry.lookup(owner, name);
    if (!property) throw new ManagedFault('ArgumentException', `Unknown dependency property '${owner}.${name}'`);
    return this.wrap(property);
  }

  wrap(property) {
    this.registry.resolve(property);
    if (this.tokens.has(property.id)) return this.tokens.get(property.id);
    const platform = this.platform;
    const reference = platform.heap.withRoots([], () => {
      const name = platform.managed(property.name, 'string');
      platform.heap.pins.push(name);
      const owner = platform.managed(property.ownerType, 'string');
      platform.heap.pins.push(owner);
      return platform.make(XAML + 'DependencyProperty', {Name: name, Owner: owner, Id: property.id});
    });
    this.tokens.set(property.id, reference);
    this.tokenDefinitions.set(identity(reference), property);
    return reference;
  }

  resolve(reference) {
    if (!isReference(reference)) throw new ManagedFault('ArgumentException', 'A registered managed dependency property is required');
    this.platform.record(reference);
    const property = this.tokenDefinitions.get(identity(reference));
    if (!property) throw new ManagedFault('ArgumentException', 'Dependency property belongs to another session or is unregistered');
    return this.registry.resolve(property);
  }

  storeFor(reference) {
    const platform = this.platform;
    const record = platform.record(reference);
    const id = identity(reference);
    let store = this.stores.get(id);
    if (store) return store;
    store = new PropertyStore({
      registry: this.registry, ownerType: record.type, owner: reference, equals, readOnlyKey: this.#readOnlyKey,
      invoke: (callback, args) => this.invoke(callback, args),
      onChange: change => this.changed(change)
    });
    this.stores.set(id, store);
    const parent = platform.get(reference, '$parent');
    if (parent) store.setParent(this.storeFor(parent));
    return store;
  }

  toNative(value, type) {
    return nativePropertyValue(this.platform, value, type);
  }

  toManaged(value, type, options) {
    return managedPropertyValue(this.platform, value, type, options);
  }

  read(reference, property, {local = false, box = false} = {}) {
    const store = this.storeFor(reference);
    this.platform.ui.journal?.captureStore(store);
    const value = local ? store.readLocalValue(property) : store.getValue(property);
    this.syncRoots(reference);
    return value === UnsetValue ? this.platform.unsetValue() : this.toManaged(value, property.propertyType, {box});
  }

  setSource(reference, property, source, value) {
    property = this.registry.resolve(property);
    const store = this.storeFor(reference);
    this.platform.ui.journal?.captureStore(store);
    try {
      return store.setSource(property, source, this.toNative(value, property.propertyType));
    } finally {
      this.syncRoots(reference);
    }
  }

  clearSource(reference, property, source = ValueSource.Local) {
    this.platform.ui.journal?.captureStore(this.storeFor(reference));
    try {
      return this.storeFor(reference).clearSource(property, source);
    } finally {
      this.syncRoots(reference);
    }
  }

  setReadOnly(reference, name, value) {
    const property = this.lookup(reference, name);
    const store = this.storeFor(reference);
    this.platform.ui.journal?.captureStore(store);
    const result = store.setReadOnlyValue(property,
      this.toNative(value, property.propertyType), this.#readOnlyKey);
    this.syncRoots(reference);
    return result;
  }

  initializeDefault(reference, name, value) {
    const property = this.lookup(reference, name), store = this.storeFor(reference);
    this.platform.ui.journal?.captureStore(store);
    const result = store.setReadOnlyValue(property, this.toNative(value, property.propertyType), this.#readOnlyKey, ValueSource.Default);
    this.syncRoots(reference);
    return result;
  }

  parent(child, parent) {
    this.storeFor(child).setParent(parent ? this.storeFor(parent) : null);
    this.syncRoots(child);
  }

  changed(change) {
    const platform = this.platform;
    const property = change.property;
    const name = property.metadata.hostProperty ?? property.name;
    const value = this.toManaged(change.newValue, property.propertyType);
    platform.heap.withRoots([change.owner, value], () => {
      platform.ui.applyingProperties++;
      try {
        platform.set(change.owner, name, value);
      } finally {
        platform.ui.applyingProperties--;
      }
      platform.command({op: 'set', id: identity(change.owner), property: name, value: platform.exportValue(value)});
      platform.ui.propertyChanged?.(change);
    });
  }

  invoke(callback, args) {
    if (typeof callback === 'function') return callback(...args);
    const platform = this.platform;
    const callbackType = platform.heap.get(callback).type;
    const signature = frameworkType(callbackType) ?? frameworkType(platform.vm.image?.types.find(type => type.name === callbackType)?.delegateContract);
    if (signature?.parameters?.length === 0) args = [];
    const converted = [];
    return platform.heap.withRoots(converted, () => {
      for (const [index, value] of args.entries()) {
        const item = value?.kind === 'DependencyProperty' ? this.wrap(value)
          : value?.property?.kind === 'DependencyProperty' ? managedPropertyChange(platform, value)
            : isReference(value) ? value : platform.managed(value, signature?.parameters[index]);
        converted.push(item);
        platform.heap.pins.push(item);
      }
      if (signature?.result === 'void') {
        const id = platform.vm.scheduler.enqueue(callback, converted, {kind: 'ui', name: 'DependencyPropertyChanged'});
        platform.ui.journal?.contexts.add(id);
        return null;
      }
      const result = platform.native(invokeManagedCallback(platform, callback, converted));
      return signature?.result === 'bool' && platform.vm.inspector ? result === 1 : result;
    });
  }

  /** Trace slots through their owner record, so an unreachable control does not become a GC root. */
  syncRoots(reference) {
    const store = this.stores.get(identity(reference));
    if (!store) return;
    const retained = [...store.retainedValues()].filter(isReference);
    const platform = this.platform;
    const old = platform.get(reference, '$propertyRoots');
    if (old) {
      const values = platform.heap.get(old).data;
      if (values.length === retained.length && values.every((value, index) => equals(value, retained[index]))) return;
      platform.ui.journal?.captureReference(old);
      platform.heap.replaceData(old, retained);
    } else if (retained.length) {
      const roots = platform.heap.allocate('array', 'object[]', retained);
      platform.heap.withRoots([roots, reference], () => platform.set(reference, '$propertyRoots', roots));
    }
  }

  *roots() {
    yield* this.tokens.values();
    yield* this.registry.retainedValues();
    this.prune();
  }

  prune() {
    const heap = this.platform.heap;
    for (const [id, store] of this.stores) {
      const reference = store.owner;
      if (heap.generations[reference.h] !== reference.g || !heap.records[reference.h]) {
        store.dispose();
        this.stores.delete(id);
      }
    }
  }

  snapshot() {
    this.prune();
    return {
      version: 1, registry: this.registry.snapshot(), tokens: [...this.tokens],
      tokenDefinitions: [...this.tokenDefinitions],
      stores: [...this.stores].map(([id, store]) => [id, store.owner, store.snapshot()])
    };
  }

  restore(snapshot) {
    if (!snapshot) return;
    if (snapshot.version !== 1) throw new ManagedFault('ArgumentException', 'Unsupported UI property snapshot');
    this.registry.restore(snapshot.registry);
    this.tokens = new Map(snapshot.tokens);
    this.tokenDefinitions = new Map(snapshot.tokenDefinitions);
    const retained = new Set(snapshot.stores.map(([id]) => id));
    for (const [id, store] of this.stores) if (!retained.has(id)) {
      store.dispose();
      this.stores.delete(id);
    }
    for (const [, owner, data] of snapshot.stores) {
      this.storeFor(owner).restore(data, {resolveParent: reference => reference ? this.storeFor(reference) : null});
    }
  }

  dispose() {
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
    this.tokens.clear();
    this.tokenDefinitions.clear();
  }
}
