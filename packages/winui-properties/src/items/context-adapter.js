import {ValueSource} from '../property/property-store.js';
import {StyleApplication} from '../styles/style-application.js';
import {ContentPresenterController} from '../templates/content-presenter.js';
import {resourceScopeModel} from '../object-model/resource-adapter-models.js';
import {itemGeneratorModel} from '../object-model/item-generator-model.js';
import {ItemsSourceController} from './items-source.js';
import {CollectionView} from './collection-view.js';
import {GroupHeaderCache} from './group-headers.js';
import {updateItemsPanel} from './panel-template.js';
import {ResourceFault} from '../resources/errors.js';
import {withUIConstruction} from '../object-model/construction-roots.js';

const controls = 'Microsoft.UI.Xaml.Controls.';
const containerTypes = {ListView: 'ListViewItem', GridView: 'GridViewItem', ItemsView: 'ItemContainer',
  ListBox: 'ListBoxItem', ComboBox: 'ComboBoxItem', FlipView: 'FlipViewItem'};

function containerType(context, owner) {
  const visited = new Set();
  for (let type = context.typeOf(owner); type && visited.size < 256 && !visited.has(type);
    type = context.baseType?.(type) ?? context.frameworkRegistry.types.get(type)?.base) {
    visited.add(type);
    const name = containerTypes[type.slice(type.lastIndexOf('.') + 1)];
    if (name) return controls + name;
  }
  return controls + 'ContentControl';
}

function sourceValue(context, item, path) {
  if (!path) return item;
  if (path.length > 1024) throw new ResourceFault('SFITEM012', 'DisplayMemberPath exceeds its budget.');
  let value = item;
  for (const name of path.split('.')) {
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) throw new ResourceFault('SFITEM012', 'DisplayMemberPath contains an invalid member.');
    if (value == null) return null;
    value = context.bindingServices?.read ? context.bindingServices.read(value, {kind: 'property', name}) : context.read(value, name);
  }
  return value;
}

function itemContentAdapter(context) {
  return {...context.templateHostAdapter, parent: value => context.parentOf(value),
    createText: text => {
      const element = context.make(controls + 'TextBlock');
      context.write(element, 'Text', context.managed(text, 'string'));
      return element;
    },
    attachRoot: (container, root, previous) => {
      if (previous) context.setVisualParent(previous, null);
      if (root) context.setVisualParent(root, container);
      const property = context.propertyRegistry.lookup(context.typeOf(container), 'Content');
      const store = context.storeFor(container);
      if (root) store.setSource(property, ValueSource.TemplatedParent, context.properties.toNative(root, property.propertyType));
      else store.clearSource(property, ValueSource.TemplatedParent);
    }};
}

export function createItemContainerAdapter(context) {
  const contentAdapter = itemContentAdapter(context);
  return {
    withConstruction: (action, roots) => withUIConstruction(context, action, roots),
    identity: value => context.id(value),
    itemIdentity: value => context.typeOf(value) && typeof value === 'object' && !value.valueType ? context.id(value) : value,
    createContainer: owner => context.invokeVirtual(owner, 'GetContainerForItemOverride', []) ?? context.make(containerType(context, owner)),
    isItemItsOwnContainer: (item, owner) => {
      const selected = context.invokeVirtual(owner, 'IsItemItsOwnContainerOverride', [item]);
      return selected == null ? context.isVisual(item) && context.propertyRegistry.isAssignable(containerType(context, owner), context.typeOf(item))
        : Boolean(context.native(selected));
    },
    setDataContext: (container, item) => {
      const store = context.storeFor(container), property = context.propertyRegistry.lookup(context.typeOf(container), 'DataContext');
      if (item === null) store.clearSource(property, ValueSource.Local);
      else store.setSource(property, ValueSource.Local, item);
    },
    resetContainer: container => {
      context.setVisualParent(container, null);
      context.write(container, '$itemIndex', -1);
    },
    prepareContent: (container, item, {template, displayMemberPath}) => {
      if (context.isVisual(item) && context.id(container) === context.id(item)) return null;
      const content = new ContentPresenterController({presenter: container, owner: container, adapter: contentAdapter,
        resources: resourceScopeModel(context, container)});
      let value = template ? item : sourceValue(context, item, displayMemberPath);
      if (!template && !context.isVisual(value)) value = context.native(value);
      content.present(value, {template});
      return content;
    },
    applyStyle: (container, style) => {
      const application = new StyleApplication({target: container, store: context.storeFor(container), registry: context.propertyRegistry,
        resources: resourceScopeModel(context, container), storeFor: value => context.storeFor(value),
        bind: context.bindSetter, materializeResource: context.materializeResource});
      application.apply(style);
      return application;
    },
    prepareContainerForItem: (container, item, index, lifetime, owner) => {
      context.write(container, '$itemIndex', index);
      context.setVisualParent(container, owner);
      context.invokeVirtual(owner, 'PrepareContainerForItemOverride', [container, item]);
    },
    clearContainerForItem: (container, item, owner) => {
      context.invokeVirtual(owner, 'ClearContainerForItemOverride', [container, item]);
      context.setVisualParent(container, null);
    },
    indexChanged: (container, index) => context.write(container, '$itemIndex', index),
    disposeContainer: container => context.templateHostAdapter.dispose?.(container)
  };
}

/** One generator owns managed content; native repeaters request indices and own only placement and selection. */
export function initializeItemsContext(context, {initialItems = 64, maxRealized = 2048} = {}) {
  if (![initialItems, maxRealized].every(value => Number.isSafeInteger(value) && value >= 0) ||
    maxRealized > 2048 || initialItems > maxRealized) throw new RangeError('Invalid item realization budgets.');
  context.itemContainerAdapter ??= createItemContainerAdapter(context);
  context.collectionView = reference => {
    const model = context.unwrapModel(reference);
    return model instanceof CollectionView ? model : null;
  };
  context.itemScene = owner => {
    const generator = context.state(owner, 'itemContainerGenerator');
    if (!generator) return null;
    const selection = context.itemSelection?.(owner) ?? {current: -1, ranges: []};
    const groups = context.state(owner, 'groupHeaders');
    return {version: 1, count: generator.items.length, revision: generator.revision, selection,
      groups: groups?.records() ?? [], groupCount: groups?.groups.length ?? 0,
      panel: context.state(owner, 'itemsPanel')?.instance?.root ?? null,
      realized: [...generator.byIndex.values()].map(entry => ({index: entry.index, item: entry.item, container: entry.container,
        key: generator.identities.keyAt(entry.index)}))};
  };
  context.realizeItemIndices = (owner, indices) => withUIConstruction(context, () => {
    if (!Array.isArray(indices) || indices.length > maxRealized) throw new ResourceFault('SFITEM013', 'Realization range budget exceeded.');
    const generator = itemGeneratorModel(context, owner);
    updateItemsPanel(context, owner);
    const desired = new Set(indices);
    for (const index of desired) if (!Number.isSafeInteger(index) || index < 0 || index >= generator.items.length) {
      throw new ResourceFault('SFITEM013', 'Realization index is outside the items collection.');
    }
    for (const index of [...generator.byIndex.keys()]) if (!desired.has(index)) generator.recycle(index);
    const references = [...desired].sort((left, right) => left - right).map(index => generator.realize(index));
    const view = context.collectionView(generator.sourceReference);
    const groups = context.state(owner, 'groupHeaders', view?.groups.length ? () => new GroupHeaderCache(context, owner) : undefined);
    groups?.update(view, [...desired]);
    context.publishItemContainers(owner, references);
    context.publishItemState?.(owner, context.itemScene(owner));
    context.syncOwner?.(owner);
    return references;
  }, [owner]);
  const changed = context.itemsChanged;
  context.itemsChanged = (owner, generator = itemGeneratorModel(context, owner)) => {
    const previous = [...generator.byIndex.keys()].filter(index => index < generator.items.length);
    const indices = previous.length ? previous : Array.from({length: Math.min(initialItems, generator.items.length)}, (_, index) => index);
    context.realizeItemIndices(owner, indices);
    changed?.(owner, generator);
  };
  context.assertItemsWritable = owner => {
    if (context.state(owner, 'itemsSource')?.source != null) {
      throw new ResourceFault('SFITEM010', 'Items is read-only while ItemsSource is set.');
    }
  };
  context.groupIndexFor = (owner, group) => context.state(owner, 'groupHeaders')?.indexFor(group) ?? -1;
  context.itemsCollectionChanged = (owner, values, delta = null) => {
    const generator = itemGeneratorModel(context, owner);
    const controller = context.state(owner, 'itemsSource', () => new ItemsSourceController(generator));
    context.assertItemsWritable(owner);
    generator.sourceReference = context.read(owner, 'Items');
    controller.items = Object.freeze([...values]);
    if (delta) controller.changed(delta);
    else generator.setItems(values);
    if (!delta || !controller.notifyChanged) context.itemsChanged(owner, generator);
  };
  const ownerOf = node => node?.id ? context.reference(node.id) : node;
  const provider = {
    realize: (node, records) => context.realizeItemIndices(ownerOf(node), records.map(record => record.index)),
    referenceFor: (node, key, index) => {
      const container = itemGeneratorModel(context, ownerOf(node)).containerFromIndex(index);
      return container ? {$ref: context.id(container)} : null;
    },
    containerFor(node, item, index) { return this.referenceFor(node, null, index); },
    indexFromContainer: (node, reference) => itemGeneratorModel(context, ownerOf(node))
      .indexFromContainer(reference?.$ref ? context.reference(reference.$ref) : reference),
    groupIndexFor: (node, group) => context.groupIndexFor(ownerOf(node), group?.$ref ? context.reference(group.$ref) : group),
    onLifecycle() {}
  };
  context.services.itemContainers = provider;
  context.services.itemGenerator = owner => itemGeneratorModel(context, owner);
  return provider;
}
