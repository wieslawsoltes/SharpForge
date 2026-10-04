import {frameworkType, frameworkAssignable, findContracts} from '@sharpforge/framework';
import {ObservableVector, validatePropertyValue, propertyValuesEqual, PropertyFault} from '@sharpforge/winui-properties';
import {adoptCollectionChild, release, assertCollectionParent, isCollectionChild} from './visual-parent.js';
import {sceneTransaction} from './scene-journal.js';

/** One authoritative collection model serves CLR-style methods, vector interfaces, bindings, and scene deltas. */
export class JavaScriptUICollection extends ObservableVector {
  constructor(context, receiver, {owner = null, property = '$items', items = []} = {}) {
    super(items, {maxItems: context.options.maxUIArrayElements ?? 1000000});
    this.context = context;
    this.receiver = receiver;
    this.owner = owner;
    this.property = property;
    this.type = context.typeOf(receiver);
    const type = frameworkType(this.type);
    this.elementType = type?.elementType ?? type?.element ?? findContracts(this.type, 'Add')[0]?.parameters[0] ?? 'object';
    this.visuals = new Map();
    this.textElements = new Map();
    this.validateItems(this.values);
    for (const value of this.values) this.rememberChild(value);
    this.onDelta = change => this.changed(change);
  }

  validateItems(values, removed = []) {
    const context = this.context;
    const removedIds = new Set(removed.filter(value => isCollectionChild(context, value)).map(value => context.id(value)));
    const seen = new Set();
    const definition = {ownerType: this.type, name: 'Item', propertyType: this.elementType, metadata: {}};
    for (const value of values) {
      validatePropertyValue(definition, value, {
        typeDefinition: frameworkType, typeOf: item => context.typeOf(item), isAssignable: frameworkAssignable
      });
      if (value === null && this.elementType === 'Microsoft.UI.Xaml.UIElement') throw new TypeError('A visual child cannot be null');
      if (!isCollectionChild(context, value)) continue;
      const id = context.id(value);
      if (seen.has(id) || (this.visuals.has(id) || this.textElements.has(id)) && !removedIds.has(id)) {
        throw new TypeError('Duplicate UI or text child');
      }
      seen.add(id);
      if (this.owner) assertCollectionParent(context, this.owner, value);
    }
  }

  rememberChild(value) {
    const context = this.context;
    if (!isCollectionChild(context, value)) return;
    (context.isVisual(value) ? this.visuals : this.textElements).set(context.id(value), value);
  }

  mutate(action) {
    const context = this.context;
    this.assertMutation();
    if (this.owner) {
      context.styles.assertCollectionMutable?.(this.owner, this.property);
      if (this.property === 'Items') context.assertItemsWritable?.(this.owner);
    }
    return sceneTransaction(context, () => {
      context.sceneJournal?.captureModel(this);
      return action();
    });
  }

  Insert(index, value) {
    this.assertIndex(index, true);
    this.validateItems([value]);
    return this.mutate(() => super.Insert(index, value));
  }

  set_Item(index, value) {
    this.assertIndex(index);
    this.validateItems([value], [this.values[index]]);
    return this.mutate(() => super.set_Item(index, value));
  }

  RemoveAt(index) {
    this.assertIndex(index);
    return this.mutate(() => super.RemoveAt(index));
  }

  Remove(value) { return this.mutate(() => super.Remove(value)); }

  Move(from, to) {
    this.assertIndex(from);
    this.assertIndex(to);
    return this.mutate(() => super.Move(from, to));
  }

  Reset(values) {
    const replacement = this.materialize(values);
    this.validateItems(replacement, this.values);
    return this.mutate(() => {
      if (replacement.length === this.values.length && replacement.every((value, index) => propertyValuesEqual(value, this.values[index]))) return;
      return super.Reset(replacement);
    });
  }

  ReplaceAll(values) { return this.Reset(values); }
  replaceAll(values) { return this.Reset(values); }

  changed(change) {
    const context = this.context;
    if (change.action !== 'Move') {
      const incoming = new Set(change.NewItems.filter(value => isCollectionChild(context, value)).map(value => context.id(value)));
      for (const value of change.OldItems) {
        if (!isCollectionChild(context, value) || incoming.has(context.id(value))) continue;
        this.visuals.delete(context.id(value));
        this.textElements.delete(context.id(value));
        if (this.owner) release(context, this.owner, value);
      }
      for (const value of change.NewItems) {
        if (!isCollectionChild(context, value)) continue;
        this.rememberChild(value);
        if (this.owner) adoptCollectionChild(context, this.owner, value);
      }
    }
    if (this.owner && (change.action === 'Move' || change.action === 'Reset'
      || change.NewStartingIndex >= 0 && change.NewStartingIndex < this.values.length - change.NewItems.length)) this.reorderVisuals();
    if (this.owner && this.property === 'Setters') context.styles.refresh(this.owner);
    if (this.owner && this.property === 'GroupStyle') context.itemsChanged?.(this.owner);
    if (this.owner) context.layoutTemplates?.collectionChanged(this.owner, this.property);
    if (this.owner && this.property === 'Items') context.itemsCollectionChanged?.(this.owner, this.values, {
      action: change.action, index: change.NewStartingIndex < 0 ? change.OldStartingIndex : change.NewStartingIndex,
      items: change.NewItems, count: change.OldItems.length, oldIndex: change.OldStartingIndex, newIndex: change.NewStartingIndex
    });
    if (!this.owner || this.property !== 'Items' || !context.itemScene?.(this.owner)) {
      const {source, ...data} = change;
      context.send({op: 'collectionChange', id: context.id(this.owner ?? this.receiver), property: this.property, change: {...data,
        NewItems: change.NewItems.map(value => context.value(value)), OldItems: change.OldItems.map(value => context.value(value))}});
    }
    context.vectorChanged?.(this.receiver, change);
    context.valueDependencies?.mutated(this.receiver);
  }

  reorderVisuals() {
    if (!this.visuals.size && !this.textElements.size) return;
    const context = this.context, node = context.objectTree.require(context.id(this.owner));
    context.sceneJournal?.captureModel(context.objectTree);
    for (const key of ['visualChildren', 'logicalChildren']) {
      const ordered = this.values.filter(value => key === 'visualChildren'
        ? context.isVisual(value) : isCollectionChild(context, value)).map(value => context.id(value));
      const children = node[key], included = ordered.filter(id => children.has(id)), keys = new Set(included);
      let index = 0;
      node[key] = new Set([...children].map(id => keys.has(id) ? included[index++] : id));
    }
  }

  snapshot() { return {...super.snapshot(), visuals: [...this.visuals], textElements: [...this.textElements]}; }
  restore(snapshot) {
    if (!Array.isArray(snapshot.visuals) || snapshot.visuals.length > this.maxItems) throw new TypeError('Invalid collection visual snapshot');
    if (snapshot.textElements && (!Array.isArray(snapshot.textElements) || snapshot.textElements.length > this.maxItems)) {
      throw new TypeError('Invalid collection text ownership snapshot');
    }
    const visuals = new Map(snapshot.visuals);
    const textElements = new Map(snapshot.textElements ?? []);
    super.restore(snapshot);
    this.visuals = visuals;
    this.textElements = textElements;
  }
}

export function collectionModelFor(context, receiver, specification = {}) {
  context.id(receiver);
  const existing = context.state(receiver, 'nativeModel');
  if (existing) return existing;
  const model = context.state(receiver, 'nativeModel', () => new JavaScriptUICollection(context, receiver,
    {...specification, items: specification.items ?? receiver.$items ?? []}));
  Object.defineProperty(receiver, '$items', {configurable: true, get: () => model.values});
  receiver[Symbol.iterator] = () => model[Symbol.iterator]();
  return model;
}

/** Only registered collection method names can reach the model; arbitrary host properties are inaccessible. */
export function invokeCollectionOperation(context, receiver, name, args) {
  const allowed = ['Add', 'Insert', 'Remove', 'RemoveAt', 'Move', 'Clear', 'ReplaceAll', 'set_Item', 'get_Item', 'Contains', 'IndexOf'];
  if (!allowed.includes(name)) throw new PropertyFault('MissingMethodException', 'Unsupported collection operation');
  const model = collectionModelFor(context, receiver);
  context.sceneJournal?.captureModel(model);
  const descriptor = findContracts(context.typeOf(receiver), name).find(member => member.parameters.length === args.length);
  if (descriptor) {
    const result = context.invoke(descriptor, receiver, args);
    if (result.handled) return result.value;
  }
  const method = model[name];
  if (typeof method !== 'function') throw new PropertyFault('NotSupportedException', 'Collection model does not implement ' + name);
  return method.apply(model, args);
}
