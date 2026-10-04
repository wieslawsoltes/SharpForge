import {UIExtensionRegistry, ValueSource, UnsetValue, registerBuiltInAttachedProperties, registerResourceAdapters,
  registerPropertyAdapters, registerObjectModelAdapters, initializeBindingContext, installDefaultTemplateCatalog,
  initializeItemsContext, initializeContentPresentation, ItemContainerGenerator, UIConstructionRoots} from '@sharpforge/winui-properties';
import {registerControlFamilyAdapters, materializeDefaultControlStyle,
  getControlFamilyModel, createLayoutTemplateServices} from '@sharpforge/winui-controls';
import {registerRenderingAdapters, registerCompositionAdapters, materializeRenderingResource,
  syncRenderingModelProperty, materializeRenderingModelDefaults, createRenderingBrushConnections} from '@sharpforge/rendering';
import {canonicalType, frameworkType, frameworkAssignable, propertiesFor, types, contracts, AnimationClock, XAML} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {ManagedPropertyServices} from './dependency-properties.js';
import {ManagedUIModelState} from './model-state.js';
import {invokeManagedCallback} from './callbacks.js';
import {registerManagedPropertyAdapters} from './property-adapters.js';
import {managedTypeName, managedPropertyType} from './property-values.js';
import {runtimeTypeObject} from '../execution/tokens.js';
import {readManagedUIProperty} from './property-read.js';
import {initializeManagedTemplates} from './template-host.js';
import {managedUIProperties} from './object-storage.js';
import {invokeManagedVirtual, registerManagedUIRuntimeAdapters, resolveManagedUIMethod} from './virtual-methods.js';
import {createManagedBindingServices} from './binding-services.js';
import {observeHeapCollections} from '../heap-collection.js';
import {initializeManagedDispatcher} from './work-queue.js';
import {initializeManagedTree, pruneManagedTree, setManagedVisualParent, publishManagedItemContainers, publishManagedItemState} from './tree-services.js';
import {createManagedValueDependencies} from './value-dependencies.js';
import {applyManagedCollectionInput} from './collection-input.js';
import {initializeManagedApplicationServices, initializeExistingFrameworkReceiver} from './application-services.js';
import {initializeFrameworkBase} from './object-storage.js';
import {isSourceUICast} from './checked-casts.js';
import {emitManagedEvent, managedEventArguments, registerManagedEventAdapters} from './events.js';
import {invokeManagedCollectionOperation, managedArrayLength, managedArrayGet, managedArraySet} from './collection-access.js';
import {createManagedXamlException, managedXamlExceptionInfo} from './xaml-exceptions.js';

/** Application-local context shared by registered UI service adapters. */
export class ManagedUIContext {
  constructor(platform) {
    this.platform = platform;
    this.construction = new UIConstructionRoots({isReference, key: value => `${value.h}:${value.g}`,
      maxRoots: platform.options.maxUIConstructionRoots ?? 1000000});
    this.services = {clockFactory: options => new AnimationClock(options), ...platform.options.uiServices};
    this.properties = new ManagedPropertyServices(platform);
    this.propertyRegistry = this.properties.registry;
    this.modelReferences = new WeakMap();
    this.modelState = new ManagedUIModelState(platform, {resolveReference: value => this.modelReferences.get(value),
      maxRetained: platform.options.maxUIModelReferences ?? (platform.options.maxUIArrayElements ?? 1000000) + 10000});
    this.models = this.modelState.owners;
    this.frameworkRegistry = {types, contracts, frameworkType, propertiesFor, canonicalType};
    this.applyingProperties = 0;
    this.registry = new UIExtensionRegistry({canonicalType, baseType: type => this.platform.heap.methodTables.get(type).base?.name});
    this.attached = registerBuiltInAttachedProperties(this.propertyRegistry, contracts);
    registerManagedPropertyAdapters(this.registry);
    registerManagedUIRuntimeAdapters(this.registry);
    for (const register of platform.options.uiAdapters ?? []) register(this.registry);
    this.currentInvocation = null;
    this.unsetValue = UnsetValue;
    this.bindingServices = createManagedBindingServices(this);
    initializeManagedDispatcher(this);
    this.bindings = initializeBindingContext(this);
    registerPropertyAdapters(this.registry, {dependencyProperties: false});
    registerResourceAdapters(this.registry);
    registerObjectModelAdapters(this.registry);
    registerControlFamilyAdapters(this.registry);
    registerRenderingAdapters(this.registry);
    registerCompositionAdapters(this.registry);
    registerManagedEventAdapters(this.registry);
    this.routedEventArgs = (payload, event) => {
      const requested = this.eventRequests?.argumentsFor(payload, event);
      if (requested) return requested;
      const previous = this.routeArgumentCache?.get(payload);
      if (previous) return previous;
      const args = managedEventArguments(this, this.reference(payload.OriginalSource), event.name, payload);
      this.routeArgumentCache?.set(payload, args);
      if (this.routeArgumentCache) this.platform.heap.pins.push(args);
      return args;
    };
    this.materializeResource = (value, type) => materializeRenderingResource(this, value, type);
    initializeManagedTemplates(this);
    initializeManagedTree(this);
    initializeItemsContext(this);
    this.layoutTemplates = createLayoutTemplateServices(this, {
      createGenerator: options => new ItemContainerGenerator({adapter: this.itemContainerAdapter, ...options})
    });
    initializeContentPresentation(this);
    installDefaultTemplateCatalog(this, materializeDefaultControlStyle);
    this.brushConnections = createRenderingBrushConnections(this);
    this.valueDependencies = createManagedValueDependencies(this);
    this.propertyChanged = change => {
      syncRenderingModelProperty(this, change.owner, change.property.name, change.newValue);
      this.valueDependencies.changed(change);
      this.valueDependencies.mutated(change.owner);
      this.brushConnections.propertyChanged(change);
      this.presentationChanged(change);
      this.layoutTemplates.changed(change);
    };
    this.services.invalidateRendering ??= value => this.valueDependencies.mutated(value);
    this.services.invalidateCanvas ??= value => {
      const owner = typeof value === 'string' ? this.reference(value) : value;
      return this.work.enqueue(() => this.emit(owner, 'Draw'), [owner]);
    };
    initializeManagedApplicationServices(this);
    this.removeCollectionObserver = observeHeapCollections(platform.heap, () => this.prune());
  }

  id(value) {
    if (!isReference(value)) throw new ManagedFault('ArgumentException', 'Managed UI reference required');
    this.platform.heap.get(value);
    return `${value.h}:${value.g}`;
  }

  reference(id) {
    if (typeof id !== 'string' || !/^\d+:\d+$/.test(id)) throw new ManagedFault('ArgumentException', 'Invalid UI identity');
    const [h, g] = id.split(':').map(Number);
    const reference = Object.freeze({h, g});
    this.platform.heap.get(reference);
    return reference;
  }

  isAlive(reference) {
    return isReference(reference) && this.platform.heap.generations[reference.h] === reference.g && !!this.platform.heap.records[reference.h];
  }

  typeOf(value) {
    return isReference(value) ? this.platform.heap.get(value).type : value?.valueType ?? null;
  }

  equals(left, right) { return this.platform.delegateEquals(left, right); }
  fromScene(value) { return value?.$ref ? this.reference(value.$ref) : value; }
  createXamlException(error) { return createManagedXamlException(this, error); }
  xamlExceptionInfo(reference) { return managedXamlExceptionInfo(this, reference); }

  typeName(value) { return managedTypeName(this.platform, value); }
  baseType(type) { return this.platform.heap.methodTables.get(type).base?.name ?? null; }
  typeValue(name) { return runtimeTypeObject(this.platform.vm, canonicalType(name)); }
  propertiesFor(type) { return managedUIProperties(this.platform, type); }
  items(collection) {
    if (Array.isArray(collection)) return collection;
    if (isReference(collection) && this.platform.heap.get(collection).kind === 'array') return this.platform.heap.get(collection).data;
    const model = this.model(collection);
    if (model?.items) return model.items;
    if (model?.[Symbol.iterator]) return [...model];
    return this.platform.items(collection);
  }
  addItem(collection, item) { return this.collectionOperation(collection, 'Add', [item]); }
  insertItem(collection, index, item) { return this.collectionOperation(collection, 'Insert', [index, item]); }
  removeItem(collection, index) { return this.collectionOperation(collection, 'RemoveAt', [index]); }
  collectionOperation(collection, name, args) { return invokeManagedCollectionOperation(this, collection, name, args); }
  arrayLength(value) { return managedArrayLength(this, value); }
  arrayGet(value, index) { return managedArrayGet(this, value, index); }
  arraySet(value, index, item) { return managedArraySet(this, value, index, item); }
  setVisualParent(child, parent) { return setManagedVisualParent(this, child, parent); }
  publishItemContainers(owner, references) { return publishManagedItemContainers(this, owner, references); }
  publishItemState(owner, projection) { return publishManagedItemState(this, owner, projection); }
  itemSelection(owner) {
    const model = getControlFamilyModel(this, owner, 'selection');
    return {current: model.selectedIndex, ranges: model.selectedRanges};
  }
  isVisual(value) { return isReference(value) && this.properties.assignable(XAML + 'UIElement', this.typeOf(value)); }
  parentOf(value) { return this.platform.get(value, '$parent'); }
  getApplication() { return this.platform.application; }
  singleton(key, factory) { return this.platform.singleton('ui:' + key, factory); }
  collectionInput(owner, property, values) { return applyManagedCollectionInput(this, owner, property, values); }
  syncOwner(owner) { this.modelState.sync(owner); }
  withConstruction(action, roots) { return this.construction.run(action, roots); }
  collectionVersion(reference) {
    if (this.platform.heap.get(reference).kind === 'array') return this.platform.heap.mutationRevision;
    const model = this.model(reference);
    return model?.version ?? model?.revision ?? this.platform.get(reference, '$version', 0);
  }

  writeReference(reference, value) {
    if (isReference(reference)) {
      const record = this.platform.heap.get(reference);
      const cell = this.platform.vm.image?.types.find(type => type.name === record.type)?.referenceCell;
      if (cell) {
        const field = cell.field ?? 0;
        const oldValue = record.data[field];
        record.data[field] = this.managed(value, cell.valueType);
        this.platform.vm.notifyWrite({kind: 'field', handle: reference.h, generation: reference.g,
          index: field, oldValue, value: record.data[field]});
        return;
      }
    }
    if (!reference?.byref || typeof this.platform.vm.dereference !== 'function') {
      throw new ManagedFault('NotSupportedException', 'This execution engine does not provide a managed out-parameter address');
    }
    this.platform.vm.dereference(reference, true, value);
  }

  native(value) {
    const unset = this.platform.singletons.get('UnsetValue');
    if (isReference(value) && unset && value.h === unset.h && value.g === unset.g) return UnsetValue;
    if (isReference(value) && this.platform.heap.get(value).kind === 'box') return this.native(this.platform.heap.get(value).data[0]);
    if (isReference(value)) {
      const record = this.platform.heap.get(value);
      if (record.kind === 'array' || record.kind === 'collection') return this.items(value);
      if (frameworkType(record.type)?.kind === 'value') return this.platform.exportValue(value);
    }
    return this.platform.native(value);
  }

  read(receiver, name) {
    if (name.startsWith('$')) return this.platform.get(receiver, name);
    return readManagedUIProperty(this.platform, receiver, {property: name});
  }

  write(receiver, name, value) {
    const platform = this.platform;
    const definition = this.propertiesFor(this.typeOf(receiver))[name];
    const type = definition?.type;
    const managed = this.managed(value, type);
    platform.heap.withRoots([receiver, managed], () => {
      if (definition?.readOnly) this.properties.setReadOnly(receiver, name, managed);
      else if (definition) platform.setProperty(receiver, {owner: this.typeOf(receiver), property: name}, managed);
      else {
        platform.set(receiver, name, managed);
        if (!name.startsWith('$') || name === '$itemIndex') {
          platform.command({op: 'set', id: this.id(receiver), property: name, value: platform.exportValue(managed)});
        }
      }
      this.modelState.sync(receiver);
    });
    return managed;
  }

  managed(value, type) {
    if (value === UnsetValue) return this.platform.unsetValue();
    if (value === null || value === undefined || isReference(value)) return value ?? null;
    type = managedPropertyType(type);
    if (value?.float || value?.byref) return value;
    if (value?.kind === 'DependencyProperty') return this.properties.wrap(value);
    if (Array.isArray(value) || ArrayBuffer.isView(value)) {
      const values = Array.from(value);
      if (frameworkType(type)?.kind === 'collection') return this.collection(values, type);
      return this.array(values, type?.endsWith('[]') ? type.slice(0, -2) : 'object');
    }
    if (typeof value === 'object') {
      const existing = this.modelReferences.get(value);
      if (existing && this.isAlive(existing)) return existing;
      type ??= value.valueType;
      if (!type || !frameworkType(type)) throw new ManagedFault('ArgumentException', 'UI model values require a registered managed type');
      const reference = this.allocate(type, value);
      this.modelReferences.set(value, reference);
      return reference;
    }
    const valueType = typeof value === 'string' ? 'string' : typeof value === 'boolean' ? 'bool'
      : typeof value === 'bigint' ? 'long' : Number.isInteger(value) ? 'int' : 'double';
    if (type === 'object' && valueType !== 'string') return this.properties.toManaged(value, valueType, {box: true});
    return this.platform.managed(value, !type || type === 'object' ? valueType : type);
  }

  array(values, elementType = 'object') {
    if (!Array.isArray(values) || values.length > (this.platform.options.maxUIArrayElements ?? 1000000)) {
      throw new ManagedFault('ArgumentException', 'UI array size limit');
    }
    const converted = [];
    return this.platform.heap.withRoots(converted, () => {
      for (const value of values) {
        const managed = this.managed(value, elementType);
        converted.push(managed);
        this.platform.heap.pins.push(managed);
      }
      return this.construction.retain(this.platform.heap.allocate('array', elementType + '[]', converted));
    });
  }

  collection(values, type) {
    const array = this.array(values, frameworkType(type)?.elementType ?? 'object');
    return this.platform.heap.withRoots([array], () => this.platform.make(type, {$items: array}, 'collection'));
  }

  allocate(type, values = {}) {
    const converted = {};
    const roots = [];
    return this.platform.heap.withRoots(roots, () => {
      for (const [name, definition] of Object.entries(propertiesFor(type))) {
        if (!definition.isStatic && definition.value !== null && definition.value !== undefined) {
          converted[name] = this.platform.managed(definition.value, definition.type);
          this.platform.heap.pins.push(converted[name]);
        }
      }
      for (const [name, value] of Object.entries(values)) {
        if (name === 'valueType') continue;
        const propertyType = propertiesFor(type)[name]?.type;
        converted[name] = isReference(value) ? value : this.managed(value, propertyType);
        this.platform.heap.pins.push(converted[name]);
      }
      const reference = this.platform.make(type, converted);
      this.platform.heap.pins.push(reference);
      this.platform.command({op: 'create', id: this.id(reference), type, properties: this.platform.exportProperties(reference)});
      return reference;
    });
  }

  make(type, args = []) {
    return this.platform.heap.withRoots(args, () => {
      const descriptor = {owner: canonicalType(type), kind: 'constructor', name: '.ctor', isStatic: true};
      const result = this.invoke(descriptor, args);
      return this.construction.retain(result.handled ? result.value : this.platform.construct(descriptor.owner, args));
    });
  }

  storeFor(receiver) {
    const store = this.properties.storeFor(receiver);
    this.journal?.captureStore(store);
    return store;
  }

  state(receiver, key, factory) {
    const value = this.modelState.state(receiver, key, factory);
    this.journal?.captureModel(value);
    return value;
  }

  model(receiver, {factory} = {}) {
    const native = this.modelState.state(receiver, 'nativeModel');
    if (native) return native;
    if (!factory) return this.modelState.owners.get(this.id(receiver))?.states.get('model')?.value;
    return this.state(receiver, 'model', factory);
  }

  wrapModel(model, type) {
    if (!model || typeof model !== 'object') return this.managed(model, type);
    const previous = this.modelReferences.get(model);
    if (previous && this.isAlive(previous)) return this.construction.retain(previous);
    if (!frameworkType(type)) throw new ManagedFault('ArgumentException', `Unregistered UI model type '${type}'`);
    const reference = this.allocate(type);
    return this.platform.heap.withRoots([reference], () => {
      this.modelReferences.set(model, reference);
      this.state(reference, 'nativeModel', () => model);
      materializeRenderingModelDefaults(this, reference, (name, value) => this.properties.initializeDefault(reference, name, value));
      this.modelState.sync(reference);
      return reference;
    });
  }

  unwrapModel(reference) {
    if (!isReference(reference)) return this.native(reference);
    const entry = this.modelState.owners.get(this.id(reference))?.states.get('nativeModel');
    if (entry) return entry.value;
    const record = this.platform.heap.get(reference);
    const kind = frameworkType(record.type)?.kind;
    if (kind === 'value' || kind === 'brush') return this.platform.exportValue(reference);
    return this.native(reference);
  }

  invokeManaged(callback, args) {
    return this.construction.retain(invokeManagedCallback(this.platform, callback, args));
  }

  invokeEventHandler(callback, args, payload) {
    return this.eventRequests?.owns(payload)
      ? this.eventRequests.invoke(callback, args, payload) : this.invokeManaged(callback, args);
  }


  invokeVirtual(receiver, slot, args = []) { return this.construction.retain(invokeManagedVirtual(this, receiver, slot, args)); }
  hasVirtual(receiver, slot, count) { return !!resolveManagedUIMethod(this, receiver, slot, count); }

  emit(receiver, event, values = {}) {
    return emitManagedEvent(this, receiver, event, values);
  }

  task(promise, {resultType = 'object', roots: extraRoots = []} = {}) {
    const current = this.currentInvocation;
    const roots = [...extraRoots, ...(current ? [current.receiver, ...current.args].filter(isReference) : [])];
    return this.platform.hostOperations.start(resultType, () => promise,
      value => this.managed(value, resultType), roots, 'ui');
  }

  invoke(descriptor, allArgs) {
    if (initializeExistingFrameworkReceiver(this, descriptor, allArgs)) {
      initializeFrameworkBase(this, allArgs[0], descriptor.owner, allArgs.slice(1));
      return {handled: true, value: null};
    }
    const constructor = descriptor.kind === 'constructor';
    const receiver = descriptor.isStatic || constructor ? null : allArgs[0]?.byref
      ? this.platform.vm.dereference(allArgs[0]) : allArgs[0];
    const args = descriptor.isStatic || constructor ? allArgs : allArgs.slice(1);
    const previous = this.currentInvocation;
    this.currentInvocation = {receiver, args, descriptor};
    try {
      const result = this.registry.invoke(this, descriptor, receiver, args);
      if (result.handled && receiver) this.modelState.sync(receiver);
      if (!result.handled || descriptor.kind === 'constructor' || isSourceUICast(this, descriptor)) return result;
      if (descriptor.result === 'void') return {...result, value: null};
      return {...result, value: this.managed(result.value, descriptor.result)};
    } finally {
      this.currentInvocation = previous;
    }
  }

  invokeAttached(descriptor, args) {
    const property = this.attached.byContract.get(descriptor.id);
    if (!property) throw new ManagedFault('MissingMethodException', 'Attached property has no registered identity');
    if (descriptor.kind === 'attachedGet') return this.properties.read(args[0], property);
    this.platform.set(args[0], '$local:' + property.name, true);
    this.properties.setSource(args[0], property, ValueSource.Local, args[1]);
    return null;
  }

  *roots() {
    yield* this.construction.roots();
    if (this.routeArgumentCache) yield* this.routeArgumentCache.values();
    if (this.journal) yield* this.journal.roots();
    yield* this.properties.roots();
    yield* this.modelState.roots();
  }

  snapshot() {
    return {version: 1, properties: this.properties.snapshot(), models: this.modelState.snapshot(), binding: this.bindingServices.snapshot()};
  }

  restore(snapshot) {
    if (!snapshot) return;
    if (snapshot.version !== 1) throw new ManagedFault('ArgumentException', 'Unsupported managed UI snapshot');
    this.bindingServices.beginRestore();
    try {
      if (snapshot.binding) this.bindingServices.restore(snapshot.binding);
      this.properties.restore(snapshot.properties);
      this.modelState.restore(snapshot.models);
      this.valueDependencies.restore();
    } finally { this.bindingServices.endRestore(); }
  }

  prune() {
    this.collecting = true;
    try {
      this.bindingServices.prune();
      this.modelState.prune();
      this.properties.prune();
      pruneManagedTree(this);
    } finally { this.collecting = false; }
  }

  dispose() {
    this.removeCollectionObserver?.();
    this.routedEventRouter.dispose();
    this.modelState.dispose({preserveValues: true, terminal: true});
    this.bindingServices.dispose();
    this.properties.dispose();
    this.controlServices.dispose();
    this.registry.clear();
  }
}
