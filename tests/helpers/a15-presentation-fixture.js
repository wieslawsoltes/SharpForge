import {DependencyPropertyRegistry, PropertyStore, ResourceScope} from '@sharpforge/winui-properties';

const controls = 'Microsoft.UI.Xaml.Controls.';
const xaml = 'Microsoft.UI.Xaml.';

/** Adapter fixture models registered property storage and explicit physical parenting, without a DOM. */
export function presentationFixture() {
  let nextId = 0;
  const nodes = [], stores = new Map(), models = new Map(), writes = [], scheduled = [];
  const bases = {ListView: 'ItemsControl', ItemsControl: 'Control', GroupItem: 'ContentControl', ContentControl: 'Control',
    ContentPresenter: 'Control', TextBlock: 'Control', StackPanel: 'Panel', Grid: 'Panel', Panel: 'Control'};
  const baseType = type => bases[type.slice(controls.length)] ? controls + bases[type.slice(controls.length)] : null;
  const registry = new DependencyPropertyRegistry({baseType, typeOf: value => value?.type ?? null});
  const width = registry.register({ownerType: controls + 'Control', name: 'Width', propertyType: 'double', metadata: {defaultValue: 0}});
  const context = {
    propertyRegistry: registry, services: {}, writes, scheduled, nodes,
    make(type) {
      const node = {id: ++nextId, type, values: {}, parent: null, disposed: false, children: []};
      nodes.push(node);
      stores.set(node, new PropertyStore({registry, owner: node, ownerType: type}));
      return node;
    },
    id: node => node?.id,
    typeOf: node => node?.type ?? null,
    read: (node, name) => node.values[name] ?? null,
    write(node, name, value) { node.values[name] = value; writes.push([node, name, value]); },
    unwrapModel: value => value,
    wrapModel: value => value,
    items: value => value,
    native: value => value,
    parentOf: node => node.parent,
    isVisual: node => typeof node?.type === 'string',
    storeFor: node => stores.get(node),
    setVisualParent: (node, parent) => { node.parent = parent; },
    scheduleUI: callback => scheduled.push(callback),
    state(owner, key, factory) {
      let table = models.get(owner);
      if (!table && factory) { table = new Map(); models.set(owner, table); }
      if (!table?.has(key) && factory) table.set(key, factory());
      return table?.get(key);
    },
    resourceScopeFor(owner) { return this.state(owner, 'resourceScope', () => new ResourceScope({owner})); }
  };
  context.templateHostAdapter = {
    isVisual: context.isVisual,
    typeOf: context.typeOf,
    storeFor: context.storeFor,
    children: node => node.children,
    setTemplatedParent(node, owner) { node.values.$templateOwner = owner; },
    setDataContext(node, data) { node.values.DataContext = data; },
    attachRoot(owner, root) { owner.templateRoot = root; if (root) context.setVisualParent(root, owner); },
    detach(node) { node.parent = null; },
    dispose(node) { node.disposed = true; }
  };
  return {context, width, controls, xaml, stores};
}
