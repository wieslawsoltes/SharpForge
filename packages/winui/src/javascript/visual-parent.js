import {frameworkAssignable, XAML} from '@sharpforge/framework';

/** Validate ownership before changing stores, resource ancestry, or either tree. */
export function assertVisualParent(context, owner, value) {
  if (!value?.$node || !frameworkAssignable(XAML + 'UIElement', value.$node.type)) return;
  assertParent(context, owner, value);
}

export function isCollectionChild(context, value) {
  return context.isVisual(value) || !!value?.$node && frameworkAssignable(XAML + 'Documents.TextElement', value.$node.type);
}

export function assertCollectionParent(context, owner, value) {
  if (!isCollectionChild(context, value)) return;
  assertParent(context, owner, value);
}

function assertParent(context, owner, value) {
  const id = context.id(value);
  const ownerId = context.id(owner);
  const previous = context.parents.get(id);
  if (previous && previous !== ownerId) throw new TypeError('A UI or text element already has a parent');
  let current = ownerId;
  let depth = 0;
  while (current) {
    if (current === id || ++depth > 1024) throw new TypeError('UI ownership cycle or depth limit');
    current = context.parents.get(current);
  }
}

export function adopt(context, owner, value) {
  if (!value?.$node || !frameworkAssignable(XAML + 'UIElement', value.$node.type)) return;
  assertVisualParent(context, owner, value);
  adoptParent(context, owner, value, true);
}

/** Inlines/Blocks inherit through their logical owner but never become visual layout children. */
export function adoptCollectionChild(context, owner, value) {
  if (!isCollectionChild(context, value)) return;
  assertCollectionParent(context, owner, value);
  adoptParent(context, owner, value, context.isVisual(value));
}

function adoptParent(context, owner, value, visual) {
  const id = context.id(value), ownerId = context.id(owner);
  if (context.parents.get(id) === ownerId) return;
  context.sceneJournal?.captureObject(value);
  context.sceneJournal?.captureModel(context.objectTree);
  const store = context.styles.storeFor?.(value);
  if (store) context.sceneJournal?.captureStore(store);
  context.parents.set(id, ownerId);
  store?.setParent(context.styles.storeFor(owner));
  context.resourceParentChanged?.(value);
  context.objectTree.register(id, {value});
  context.objectTree.register(ownerId, {value: owner});
  const templateOwner = value.$values.$templateOwner;
  context.objectTree.setLogicalParent(id, templateOwner ? context.id(templateOwner) : ownerId);
  if (visual) context.objectTree.setVisualParent(id, ownerId);
}

export function release(context, owner, value) {
  if (!value?.$node || context.parents.get(value.$node.id) !== context.id(owner)) return;
  context.sceneJournal?.captureObject(value);
  context.sceneJournal?.captureModel(context.objectTree);
  const store = context.styles.storeFor?.(value);
  if (store) context.sceneJournal?.captureStore(store);
  context.parents.delete(value.$node.id);
  store?.setParent(null);
  context.objectTree.setLogicalParent(value.$node.id, null);
  context.objectTree.setVisualParent(value.$node.id, null);
  context.resourceParentChanged?.(value);
}
