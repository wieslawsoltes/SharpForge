import {UIObjectTree, getResourceServices} from '@sharpforge/winui-properties';
import {RoutedEventRouter} from '@sharpforge/winui-controls';
import {XAML} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {managedItemScene} from './scene.js';

const same = (left, right) => left === right || !!left && !!right && left.h === right.h && left.g === right.g;

export function assertManagedVisualParent(context, reference, parent) {
  if (!context.isVisual(reference) || parent === null) return;
  assertParent(context, reference, parent);
}

/** TextElement collection ownership participates in inheritance without adding visual descendants. */
export function isManagedCollectionChild(context, reference) {
  return context.isVisual(reference) || isReference(reference)
    && context.properties.assignable(XAML + 'Documents.TextElement', context.typeOf(reference));
}

export function assertManagedCollectionParent(context, reference, parent) {
  if (!isManagedCollectionChild(context, reference) || parent === null) return;
  assertParent(context, reference, parent);
}

function assertParent(context, reference, parent) {
  const previous = context.parentOf(reference);
  if (previous && !same(previous, parent)) throw new ManagedFault('InvalidOperationException', 'UI or text element already belongs to another parent');
  let depth = 0;
  for (let current = parent; current; current = context.parentOf(current)) {
    if (same(current, reference) || ++depth > 1024) throw new ManagedFault('InvalidOperationException', 'UI ownership cycle or depth limit');
  }
}

/** Keep dependency inheritance, resources and both tree projections in the same parent transition. */
export function setManagedVisualParent(context, reference, parent) {
  if (!context.isVisual(reference)) return;
  assertManagedVisualParent(context, reference, parent);
  if (same(context.parentOf(reference), parent)) return;
  context.platform.set(reference, '$parent', parent);
  context.properties.parent(reference, parent);
  context.resourceParentChanged(reference);
  parentManagedVisual(context, reference, parent);
}

export function setManagedCollectionParent(context, reference, parent) {
  if (context.isVisual(reference)) return setManagedVisualParent(context, reference, parent);
  if (!isManagedCollectionChild(context, reference) || same(context.parentOf(reference), parent)) return;
  assertManagedCollectionParent(context, reference, parent);
  context.journal?.captureStore(context.properties.storeFor(reference));
  context.platform.set(reference, '$parent', parent);
  context.properties.parent(reference, parent);
  context.resourceParentChanged(reference);
  context.objectTree.setLogicalParent(register(context, reference), parent ? register(context, parent) : null);
}

export function publishManagedItemContainers(context, owner, references) {
  const maximum = context.properties.assignable(XAML + 'Controls.AnnotatedScrollBar', context.typeOf(owner)) ? 2049 : 2048;
  if (!Array.isArray(references) || references.length > maximum || references.some(value => !context.isVisual(value))) {
    throw new ManagedFault('ArgumentException', 'Invalid realized item container set');
  }
  const values = context.array(references);
  context.platform.heap.withRoots([owner, values], () => context.platform.set(owner, '$itemContainers', values));
  context.platform.command({op: 'collection', id: context.id(owner), property: '$itemContainers',
    items: references.map(value => context.platform.exportValue(value))});
}

export function publishManagedItemState(context, owner, projection) {
  context.platform.command({op: 'set', id: context.id(owner), property: '$items', value: managedItemScene(context.platform, projection)});
}

/** The managed tree uses the same stable visual/logical identities as the retained browser host. */
export function initializeManagedTree(context) {
  context.objectTree = context.state(null, 'uiTree', () => new UIObjectTree({
    onEvent: (owner, event, payload) => {
      if (!context.isAlive(owner) || context.collecting) return;
      const store = context.properties.stores.get(context.id(owner));
      if (store && event === 'Loaded') context.bindings.loaded(store);
      if (store && event === 'Unloaded') context.bindings.unloaded(store);
      context.bindingLifecycle?.(owner, event);
      if (event === 'Loaded') context.brushConnections?.attach(owner);
      if (event === 'Unloaded') context.brushConnections?.detach(owner);
      context.platform.enqueueEvent(owner, event, payload);
    }
  }));
  context.routedEventRouter = new RoutedEventRouter({
    parentOf: id => context.objectTree.getVisualParent(id), contains: id => context.objectTree.contains(id)
  });
}

function register(context, reference) {
  context.journal?.captureModel(context.objectTree);
  const id = context.id(reference);
  context.objectTree.register(id, {value: reference});
  return id;
}

export function parentManagedVisual(context, reference, parent) {
  if (!context.isVisual(reference)) return;
  const id = register(context, reference);
  const owner = parent ? register(context, parent) : null;
  const templateOwner = parent ? context.platform.get(reference, '$templateOwner') : null;
  context.objectTree.setLogicalParent(id, templateOwner ? register(context, templateOwner) : owner);
  context.objectTree.setVisualParent(id, owner);
}

export function prepareManagedVisuals(context, root) {
  const seen = new Set(), queue = [root];
  for (let index = 0; index < queue.length; index++) {
    if (index >= 100000) throw new RangeError('UI preparation node budget exceeded');
    const owner = queue[index], id = register(context, owner);
    if (seen.has(id)) continue;
    seen.add(id);
    if (context.properties.assignable(XAML + 'FrameworkElement', context.typeOf(owner))) {
      const resources = getResourceServices(context);
      resources.applyStyle(owner);
      if (context.propertiesFor(context.typeOf(owner)).Template) resources.applyTemplate(owner);
    }
    context.layoutTemplates.prepare(owner);
    for (const child of context.templateHostAdapter.children(owner)) {
      parentManagedVisual(context, child, owner);
      queue.push(child);
    }
    const template = context.platform.get(owner, '$templateRoot');
    if (template) { parentManagedVisual(context, template, owner); queue.push(template); }
  }
  context.flushContentPresenters?.();
}

export function managedVisualLifecycle(context, root, event) {
  if (!context.isAlive(root)) return;
  if (event === 'Loaded') prepareManagedVisuals(context, root);
  const id = register(context, root);
  if (event === 'Loaded') context.objectTree.roots.add(id);
  else context.objectTree.roots.delete(id);
  context.objectTree.setConnected(id, event === 'Loaded');
}

export function trackManagedTreeCommand(context, command) {
  context.journal?.captureModel(context.objectTree);
  if (command.op === 'create' && command.id) {
    const reference = context.reference(command.id);
    if (context.isVisual(reference) || context.typeOf(reference) === XAML + 'Window') register(context, reference);
  } else if (command.op === 'template' && command.root) {
    parentManagedVisual(context, context.reference(command.root), context.reference(command.id));
  } else if (command.op === 'remove') context.objectTree.remove(command.id);
}

export function pruneManagedTree(context) {
  for (const [id, node] of context.objectTree.nodes) {
    if (context.isAlive(node.value)) continue;
    context.routedEventRouter.removeNode(id);
    context.objectTree.remove(id);
  }
}
