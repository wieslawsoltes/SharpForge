import {initializeResourceContext, ValueSource, isVisualContentProperty} from '@sharpforge/winui-properties';
import {adopt, release} from './collections.js';
import {sceneTransaction} from './scene-journal.js';

/** JavaScript and managed templates share construction and subscription algorithms. */
export function initializeJavaScriptTemplates(context) {
  const adapter = {
    withConstruction: (action, roots) => context.withConstruction(action, roots),
    typeOf: value => context.typeOf(value), storeFor: value => context.storeFor(value),
    isVisual: value => context.isVisual(value), name: value => context.read(value, 'Name'),
    children: value => visualChildren(context, value),
    isTemplateBoundary: value => !!value.$values.$templateRoot,
    setTemplatedParent(node, owner, namescope) {
      context.sceneJournal?.captureObject(node);
      context.sceneJournal?.captureModel(context.objectTree);
      node.$values.$templateOwner = owner;
      const logicalParent = owner ?? context.parentOf(node);
      context.objectTree.register(context.id(node), {value: node});
      if (logicalParent) context.objectTree.register(context.id(logicalParent), {value: logicalParent});
      context.objectTree.setLogicalParent(context.id(node), logicalParent ? context.id(logicalParent) : null);
      node.$values.$nameScope = namescope ? context.wrapModel(namescope, 'Microsoft.UI.Xaml.NameScope') : null;
      context.send({op: 'templateOwner', id: context.id(node), owner: owner ? context.id(owner) : null});
    },
    setDataContext(root, data) {
      if (data === undefined) return;
      const property = context.propertyRegistry.lookup(context.typeOf(root), 'DataContext');
      if (property) context.storeFor(root).setSource(property, ValueSource.Inherited, data);
    },
    attachRoot(owner, next, previous) {
      if (next) adopt(context, owner, next);
      if (previous) release(context, owner, previous);
      owner.$values.$templateRoot = next;
      context.send({op: 'template', id: context.id(owner), root: next ? context.id(next) : null});
    },
    detach(node) {
      const parent = context.parentOf(node);
      if (parent) release(context, parent, node);
    },
    dispose(node) {
      const states = context.states.get(node);
      context.states.delete(node);
      context.models.delete(node);
      for (const model of states?.values() ?? []) model?.dispose?.();
      context.styles.disposeOwner?.(node);
      context.send({op: 'remove', id: context.id(node)});
    }
  };
  initializeResourceContext(context, adapter);
  context.sceneTransaction = action => sceneTransaction(context, action);
  context.onApplyTemplate = owner => context.invokeVirtual(owner, 'OnApplyTemplate', []);
}

function visualChildren(context, owner) {
  const values = Object.entries(owner.$values).filter(([name, value]) => isVisualContentProperty(name) && context.isVisual(value))
    .map(([, value]) => value);
  values.push(...(owner.$values.$itemContainers ?? []));
  for (const [name, collection] of Object.entries(owner.$collections)) {
    if (!isVisualContentProperty(name, true)) continue;
    for (const value of collection) if (context.isVisual(value)) values.push(value);
  }
  return values;
}
