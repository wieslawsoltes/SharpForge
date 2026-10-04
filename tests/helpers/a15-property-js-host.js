import {canonicalType, frameworkAssignable, frameworkType, propertiesFor} from '@sharpforge/framework';
import {DependencyPropertyRegistry, PropertyStore, UIExtensionRegistry, UIObjectTree, registerPropertyAdapters,
  initializeVectorContext} from '@sharpforge/winui-properties';
import {RoutedEventRouter} from '@sharpforge/winui-controls';
import {invokeCollectionOperation} from '../../packages/winui/src/javascript/collections.js';
import {completeFacadeRoute} from '../../packages/winui/src/javascript/events.js';

/** An explicit in-memory scene host exercises the facade's real journals/models/router without a DOM. */
export function propertyJavaScriptHost() {
  const states = new Map(), stores = new Map(), commands = [], lostFocus = [];
  const registry = new DependencyPropertyRegistry({canonicalType, isAssignable: frameworkAssignable});
  let serial = 0;
  const context = {
    options: {}, services: {}, objects: new Map(), parents: new Map(), models: new Map(), modelReferences: new WeakMap(), states,
    objectTree: new UIObjectTree(), propertyRegistry: registry,
    registry: new UIExtensionRegistry({canonicalType, baseType: type => frameworkType(type)?.base}),
    id(value) {
      if (value?.$context !== this.objects) throw new TypeError('Foreign application object');
      return value.$node.id;
    },
    typeOf: value => value?.$node?.type ?? value?.valueType ?? null,
    propertiesFor,
    isVisual: value => !!value?.$node && frameworkAssignable('Microsoft.UI.Xaml.UIElement', value.$node.type),
    allocate(type) {
      const value = {$node: {id: 'n' + ++serial, type}, $context: this.objects,
        $values: {}, $events: {}, $collections: {}, $locals: new Set()};
      if (frameworkType(type)?.kind === 'collection') value.$items = [];
      this.objects.set(value.$node.id, value);
      this.objectTree.register(value.$node.id, {value});
      this.sceneJournal?.created.add(value);
      return value;
    },
    reference(id) { return this.objects.get(id); },
    native: value => value,
    managed: value => value,
    properties: {toNative: value => value},
    value: value => value?.$node ? {$ref: value.$node.id} : value,
    invoke(descriptor, receiver, args) { return this.registry.invoke(this, descriptor, receiver, args); },
    invokeManaged: (callback, args) => callback(...args),
    state(owner, name, factory) {
      let entries = states.get(owner);
      if (!entries) { if (!factory) return undefined; states.set(owner, entries = new Map()); }
      if (!entries.has(name) && factory) entries.set(name, factory());
      const value = entries.get(name);
      if (value) this.sceneJournal?.captureModel(value);
      return value;
    },
    model(value) { return this.state(value, 'nativeModel'); },
    unwrapModel(value) { return this.model(value) ?? value; },
    wrapModel(model, type) {
      const previous = this.modelReferences.get(model);
      if (previous) return previous;
      const value = this.allocate(type);
      this.modelReferences.set(model, value); this.state(value, 'nativeModel', () => model);
      return value;
    },
    items(value) { const model = this.unwrapModel(value); return model.items ?? model.$items ?? [...model]; },
    collectionVersion(value) { return this.unwrapModel(value).version ?? 0; },
    collectionOperation(receiver, name, args) { return invokeCollectionOperation(this, receiver, name, args); },
    read(owner, name) { return owner.$collections[name] ?? owner.$values[name] ?? propertiesFor(owner.$node.type)[name]?.value; },
    write(owner, name, value) { this.sceneJournal?.captureObject(owner); owner.$values[name] = value; },
    storeFor(owner) {
      if (!stores.has(owner)) stores.set(owner, new PropertyStore({registry, owner, ownerType: this.typeOf(owner)}));
      const store = stores.get(owner);
      this.sceneJournal?.captureStore(store);
      return store;
    },
    send(command) { if (this.sceneCommands) this.sceneCommands.push(command); else commands.push(command); },
    getBindingOperations: () => ({LostFocus: store => lostFocus.push(store), services: {
      write(buffer, step, value) { if (step.key < 0 || step.key >= buffer.length) throw new RangeError('Array bounds'); buffer[step.key] = value; }
    }}),
    writeReference(holder, value) { holder.value = value; },
    host: {getLayout: () => ({x: 0, y: 0, width: 100, height: 100})}
  };
  context.styles = {storeFor: owner => context.storeFor(owner), assertCollectionMutable: () => {}, refresh: () => {}};
  context.routedEventRouter = new RoutedEventRouter({parentOf: id => context.parents.get(id), contains: id => context.objects.has(id),
    onDispatch: (id, name, payload) => completeFacadeRoute(context, id, name, payload)});
  initializeVectorContext(context);
  registerPropertyAdapters(context.registry);
  return {context, commands, lostFocus};
}
