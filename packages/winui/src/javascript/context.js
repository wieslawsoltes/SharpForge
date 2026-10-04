import {UIExtensionRegistry, prepareUICommand, UnsetValue, ValueSource, registerResourceAdapters,
  UIConstructionRoots} from '@sharpforge/winui-properties';
import {canonicalType, frameworkType, frameworkAssignable, propertiesFor, types, contracts, AnimationClock, XAML} from '@sharpforge/framework';
import {JavaScriptValueFactories} from './values.js';
import {createUIObjectCollection, adopt, release, invokeCollectionOperation, applyFacadeCollectionInput} from './collections.js';
import {emitFacadeEvent} from './events.js';
import {initializeJavaScriptTemplates} from './template-host.js';
import {javascriptObjectTree} from './services.js';
import {serializeRenderingValue, typeOfRenderingModel, materializeRenderingModelDefaults} from '@sharpforge/rendering';
import {getControlFamilyModel} from '@sharpforge/winui-controls';
import {resolveJavaScriptOverride} from './virtual-methods.js';

/** Closed UI adapters share one explicit context across the managed and JavaScript hosts. */
export class JavaScriptUIContext {
  constructor(options = {}) {
    this.options = options;
    this.objects = new Map();
    this.construction = new UIConstructionRoots({isReference: value => value?.$context === this.objects,
      key: value => value.$node.id, maxRoots: options.maxUIConstructionRoots ?? 1000000});
    this.classes = new Map();
    this.namespaces = {};
    this.parents = new Map();
    this.states = new WeakMap();
    this.applicationStates = new Map();
    this.models = new Map();
    this.frameworkRegistry = {types, contracts, frameworkType, propertiesFor, canonicalType};
    this.modelReferences = new WeakMap();
    this.tasks = new WeakSet();
    this.singletons = new Map();
    this.serial = 0;
    this.disposed = false;
    this.objectTree = javascriptObjectTree(this);
    this.registry = new UIExtensionRegistry({canonicalType, baseType: type => frameworkType(type)?.base});
    this.values = new JavaScriptValueFactories(this);
    this.services = {clockFactory: options => new AnimationClock(options), ...options.uiServices};
    this.services.defaultStyleValues ??= (receiver, values) => {
      this.id(receiver);
      const store = this.storeFor(receiver);
      for (const [name, value] of Object.entries(values)) {
        const property = this.propertyRegistry.lookup(this.typeOf(receiver), name);
        if (!property) throw new TypeError(`Unknown default-style dependency property '${name}'`);
        store.setSource(property, ValueSource.DefaultStyle, value);
      }
    };
    for (const register of options.uiAdapters ?? []) register(this.registry);
    registerResourceAdapters(this.registry);
    initializeJavaScriptTemplates(this);
  }

  id(value) {
    if (value?.$context !== this.objects) throw new TypeError('UI object belongs to another application');
    return value.$node.id;
  }

  typeOf(value) { return value?.$node?.type ?? value?.valueType ?? null; }
  reference(id) {
    const object = this.objects.get(id);
    if (!object) throw new TypeError('Unknown UI object identity');
    return object;
  }
  fromScene(value) {
    if (!value?.$ref) return value;
    const object = this.objects.get(value.$ref);
    if (!object) throw new TypeError('The UI input references an unknown object');
    return object;
  }
  typeName(value) {
    const name = typeof value === 'string' ? value : value?.$type ?? value?.FullName;
    if (typeof name !== 'string' || !name) throw new TypeError('A registered type or canonical type name is required');
    return canonicalType(name);
  }
  typeValue(name) { return this.classes.get(canonicalType(name)) ?? Object.freeze({FullName: canonicalType(name)}); }
  propertiesFor(type) { return propertiesFor(type); }
  items(collection) {
    const model = collection?.$node ? this.unwrapModel(collection) : collection;
    return model?.$items ?? model?.items ?? [...model];
  }
  addItem(collection, item) { return collection.Add(item); }
  insertItem(collection, index, item) { return collection.Insert(index, item); }
  removeItem(collection, index) { return collection.RemoveAt(index); }
  collectionOperation(collection, name, args) { return invokeCollectionOperation(this, collection, name, args); }
  collectionInput(owner, property, values) { return applyFacadeCollectionInput(this, owner, property, values); }
  setVisualParent(child, parent) {
    if (parent) adopt(this, parent, child);
    else {
      const previous = this.parentOf(child);
      if (previous) release(this, previous, child);
    }
  }
  publishItemContainers(owner, references) {
    this.id(owner);
    const maximum = frameworkAssignable(XAML + 'Controls.AnnotatedScrollBar', this.typeOf(owner)) ? 2049 : 2048;
    if (!Array.isArray(references) || references.length > maximum || references.some(value => !this.isVisual(value))) {
      throw new TypeError('Invalid realized item container set');
    }
    this.sceneJournal?.captureObject(owner);
    owner.$values.$itemContainers = [...references];
    this.send({op: 'collection', id: this.id(owner), property: '$itemContainers', items: references.map(value => this.value(value))});
  }
  publishItemState(owner, projection) {
    const value = {...projection, realized: projection.realized.map(record => ({...record,
      item: this.value(record.item), container: this.value(record.container)}))};
    if (projection.groups) value.groups = projection.groups.map(group => ({...group,
      group: this.value(group.group), header: this.value(group.header)}));
    if (projection.panel) value.panel = this.value(projection.panel);
    this.send({op: 'set', id: this.id(owner), property: '$items', value});
  }
  itemSelection(owner) {
    const model = getControlFamilyModel(this, owner, 'selection');
    return {current: model.selectedIndex, ranges: model.selectedRanges};
  }
  isVisual(value) { return !!value?.$node && frameworkAssignable(XAML + 'UIElement', value.$node.type); }
  parentOf(value) { return this.objects.get(this.parents.get(value.$node.id)); }
  getApplication() { return this.application; }
  singleton(key, factory) {
    if (!this.singletons.has(key)) this.singletons.set(key, factory());
    return this.singletons.get(key);
  }
  collectionVersion(reference) { return this.unwrapModel(reference)?.version ?? reference?.$version ?? 0; }
  withConstruction(action, roots) { return this.construction.run(action, roots); }
  writeReference(reference, value) {
    if (!reference || typeof reference !== 'object' || !Object.hasOwn(reference, 'value')) throw new TypeError('An out-value holder is required');
    reference.value = value;
  }
  baseType(type) { return frameworkType(type)?.base; }
  native(value) { return value; }
  createXamlException(error) { return error; }
  xamlExceptionInfo(error) { return {lineNumber: error.lineNumber, linePosition: error.linePosition}; }
  read(receiver, property) {
    if (!receiver?.$node) return receiver?.[property];
    if (property === 'Count' && receiver.$items) {
      const model = this.unwrapModel(receiver);
      return model !== receiver ? model.Count ?? model.items?.length ?? receiver.$items.length : receiver.$items.length;
    }
    const definition = propertiesFor(receiver.$node.type)[property];
    const collection = frameworkType(definition?.type)?.kind === 'collection';
    if (definition && this.styles && frameworkAssignable(XAML + 'DependencyObject', receiver.$node.type)) {
      const token = this.propertyRegistry.lookup(receiver.$node.type, property);
      if (token) {
        const store = this.storeFor(receiver);
        const value = store.getValue(token);
        if (!collection || value !== null || store.getValueSource(token) !== ValueSource.Default) return value;
      }
    }
    if (definition && typeOfRenderingModel(this.unwrapModel(receiver))) {
      const result = this.invoke({owner: receiver.$node.type, kind: 'get', name: 'get_' + property, result: definition.type}, receiver, []);
      if (result.handled) return result.value;
    }
    if (collection) {
      return receiver.$collections[property] ??= createUIObjectCollection(this, receiver, property);
    }
    return receiver.$values[property];
  }
  managed(value) { return value === UnsetValue ? this.styles.unset : value; }
  array(values) { return [...values]; }
  arrayLength(value) { return requireJavaScriptArray(value).length; }
  arrayGet(value, index) { return requireJavaScriptArray(value, index)[index]; }
  arraySet(value, index, item) { requireJavaScriptArray(value, index)[index] = item; return item; }
  collection(values, type) {
    const collection = this.allocate(type);
    collection.$items = [...values];
    collection[Symbol.iterator] = () => collection.$items[Symbol.iterator]();
    return collection;
  }
  isTask(value) { return this.tasks.has(value); }

  write(receiver, property, value) {
    this.id(receiver);
    this.sceneJournal?.captureObject(receiver);
    const definition = propertiesFor(receiver.$node.type)[property];
    if (definition?.readOnly) this.styles.setReadOnly(receiver, property, value);
    else if (definition) this.styles.set(receiver, property, value);
    else {
      receiver.$values[property] = value;
      if (!property.startsWith('$') || property === '$itemIndex') {
        this.send({op: 'set', id: receiver.$node.id, property, value: this.value(value)});
      }
    }
    return value;
  }

  value(value) {
    if (value?.$node) {
      const model = this.state(value, 'nativeModel');
      if (typeOfRenderingModel(model)) return serializeRenderingValue(model);
      const kind = frameworkType(value.$node.type)?.kind;
      if (kind === 'value' || kind === 'brush') {
        return {valueType: value.$node.type, ...Object.fromEntries(Object.entries(value.$values).map(([key, item]) => [key, this.value(item)]))};
      }
      return {$ref: value.$node.id};
    }
    if (value?.valueType) {
      return Object.fromEntries(Object.keys(value).map(key => [key, key === 'valueType' ? value[key] : this.value(value[key])]));
    }
    return value;
  }

  send(command) {
    if (this.disposed) throw new Error('Application has been disposed');
    const suppressed = this.suppressedSceneProperty;
    if (command.op === 'set' && suppressed && command.id === this.id(suppressed.owner) && command.property === suppressed.name) return;
    if (this.sceneCommands) { this.sceneCommands.push(command); return; }
    const prepared = prepareUICommand(command, id => this.objects.get(id)?.$node.type);
    if (prepared.command) this.host.apply(prepared.command);
    for (const update of prepared.privateValues) this.host.setPrivateValue(update.id, update.property, update.value);
  }

  allocate(type, values = {}) {
    const Type = this.classes.get(type);
    if (!Type) throw new TypeError(`UI type '${type}' is not registered`);
    if (this.objects.size >= (this.options.maxUIObjects ?? 100000)) throw new RangeError('UI object limit exceeded');
    const object = Object.create(Type.prototype);
    object.$context = this.objects;
    object.$node = {id: 'js:' + ++this.serial, type};
    object.$values = {};
    object.$locals = new Set();
    object.$events = {};
    object.$collections = {};
    for (const [name, definition] of Object.entries(propertiesFor(type))) {
      if (!definition.isStatic) object.$values[name] = definition.value ?? null;
    }
    Object.assign(object.$values, values);
    for (const name of Object.keys(values)) object.$locals.add(name);
    this.objects.set(object.$node.id, object);
    this.construction.retain(object);
    if (frameworkType(type)?.kind === 'collection') object.$items = [];
    this.sceneJournal?.created.add(object);
    this.objectTree.register(object.$node.id, {value: object});
    if (type === XAML + 'Application') this.application = object;
    this.send({op: 'create', ...object.$node, properties: Object.fromEntries(Object.entries(object.$values).map(([key, item]) => [key, this.value(item)]))});
    return object;
  }

  make(type, args = []) {
    const Type = this.classes.get(canonicalType(type));
    if (!Type) throw new TypeError(`UI type '${type}' is not registered`);
    return this.construction.retain(new Type(...args));
  }

  state(receiver, key, factory) {
    let states = receiver ? this.states.get(receiver) : this.applicationStates;
    if (!states) { states = new Map(); this.states.set(receiver, states); }
    if (!states.has(key)) {
      if (typeof factory !== 'function') return undefined;
      states.set(key, factory());
      this.models.set(receiver, states);
    }
    const value = states.get(key);
    this.sceneJournal?.captureModel(value);
    return value;
  }

  model(receiver, {factory} = {}) { return this.state(receiver, 'nativeModel') ?? this.state(receiver, 'model', factory); }
  storeFor(receiver) { return this.styles.storeFor(receiver); }

  wrapModel(model, type) {
    if (!model || typeof model !== 'object') return model;
    const previous = this.modelReferences.get(model);
    if (previous && this.objects.get(previous.$node.id) === previous) return this.construction.retain(previous);
    const object = this.allocate(type);
    this.modelReferences.set(model, object);
    this.state(object, 'nativeModel', () => model);
    materializeRenderingModelDefaults(this, object, (name, value) => this.styles.initializeDefault(object, name, value));
    return object;
  }

  unwrapModel(value) { return value?.$node ? this.state(value, 'nativeModel') ?? value : value; }
  invokeManaged(callback, args) { return this.construction.retain(callback(...args)); }
  hasVirtual(receiver, name) { return !!resolveJavaScriptOverride(this, receiver, name); }
  invokeVirtual(receiver, slot, args = []) {
    const callback = resolveJavaScriptOverride(this, receiver, slot);
    return callback ? this.construction.retain(callback.apply(receiver, args)) : null;
  }

  emit(receiver, event, values = {}) {
    return emitFacadeEvent(this, receiver, event, values);
  }

  requestEvent(receiver, event, values = {}, options = {}) {
    return this.host.requestEvent(typeof receiver === 'string' ? receiver : this.id(receiver), event, values, options);
  }

  task(promise) {
    const task = Promise.resolve(promise);
    this.tasks.add(task);
    return task;
  }

  invoke(descriptor, receiver, args) { return this.registry.invoke(this, descriptor, receiver, args); }

  dispose() {
    if (this.disposed) return;
    for (const states of this.models.values()) for (const model of states.values()) model?.dispose?.();
    this.controlServices?.dispose();
    this.composition?.dispose();
    if (this.ownsFrameScheduler) this.frameScheduler.dispose();
    this.models.clear();
    this.applicationStates.clear();
    this.singletons.clear();
    this.registry.clear();
    this.animations.dispose();
    this.styles.dispose?.();
    this.host.dispose();
    this.objects.clear();
    this.disposed = true;
  }
}

function requireJavaScriptArray(value, index) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || !Number.isSafeInteger(value.length)) throw new TypeError('An array is required');
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 0 || index >= value.length)) {
    throw new RangeError('Array index is outside the target');
  }
  return value;
}
