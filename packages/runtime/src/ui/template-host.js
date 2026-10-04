import {ValueSource, initializeResourceContext, isVisualContentProperty} from '@sharpforge/winui-properties';
import {frameworkType, XAML} from '@sharpforge/framework';
import {isReference} from '../heap.js';

/** Typed template lifetimes translate into incremental commands and owner-scoped managed references. */
export function initializeManagedTemplates(context) {
  const platform = context.platform;
  const adapter = {
    withConstruction: (action, roots) => context.withConstruction(action, roots),
    typeOf: value => context.typeOf(value), storeFor: value => context.storeFor(value),
    isVisual: value => context.isVisual(value), name: value => context.native(context.read(value, 'Name')),
    children: value => visualChildren(context, value),
    isTemplateBoundary: value => !!platform.get(value, '$templateRoot'),
    setTemplatedParent: (node, owner, namescope) => {
      platform.set(node, '$templateOwner', owner);
      const logicalParent = owner ?? context.parentOf(node);
      context.objectTree.register(context.id(node), {value: node});
      if (logicalParent) context.objectTree.register(context.id(logicalParent), {value: logicalParent});
      context.objectTree.setLogicalParent(context.id(node), logicalParent ? context.id(logicalParent) : null);
      const scope = namescope ? context.wrapModel(namescope, XAML + 'NameScope') : null;
      platform.heap.withRoots([node, scope], () => platform.set(node, '$nameScope', scope));
      platform.command({op: 'templateOwner', id: context.id(node), owner: owner ? context.id(owner) : null});
    },
    setDataContext: (root, data) => {
      if (data === undefined) return;
      const property = context.propertyRegistry.lookup(context.typeOf(root), 'DataContext');
      if (property) context.properties.setSource(root, property, ValueSource.Inherited, data);
    },
    attachRoot: (owner, next, previous) => attachRoot(context, owner, next, previous),
    detach: node => {
      if (!context.isAlive(node)) return;
      context.setVisualParent(node, null);
    },
    dispose: node => disposeTemplateNode(context, node)
  };
  initializeResourceContext(context, adapter);
  context.sceneTransaction = action => platform.styleMutation(action);
  context.onApplyTemplate = owner => context.invokeVirtual?.(owner, 'OnApplyTemplate', []);
}

function visualChildren(context, owner) {
  const platform = context.platform;
  const values = [];
  const containers = platform.get(owner, '$itemContainers');
  if (containers) values.push(...context.items(containers));
  for (const [name, value] of platform.propertyEntries(owner)) {
    if (name.startsWith('$') || !isReference(value)) continue;
    if (context.isVisual(value) && isVisualContentProperty(name)) values.push(value);
    else if (isVisualContentProperty(name, true) &&
      (platform.heap.get(value).kind === 'collection' || frameworkType(context.typeOf(value))?.kind === 'collection')) {
      values.push(...context.items(value).filter(item => context.isVisual(item)));
    }
  }
  return values;
}

function attachRoot(context, owner, next, previous) {
  if (!context.isAlive(owner)) return;
  const platform = context.platform;
  if (next) platform.parent(next, owner);
  if (previous) {
    context.setVisualParent(previous, null);
  }
  platform.set(owner, '$templateRoot', next);
  platform.command({op: 'template', id: context.id(owner), root: next ? context.id(next) : null});
}

function disposeTemplateNode(context, node) {
  if (!context.isAlive(node)) return;
  const id = context.id(node);
  const owner = context.modelState.owners.get(id);
  if (owner) {
    context.modelState.owners.delete(id);
    context.modelState.disposeOwner(owner);
  }
  const store = context.properties.stores.get(id);
  store?.dispose();
  context.properties.stores.delete(id);
  context.platform.command({op: 'remove', id});
}
