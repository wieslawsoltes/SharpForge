import { managedTreeModel } from './adapters.js';
import { CONTROLS } from '../policy/adapter-helpers.js';

/** Browser expansion/selection projects into the same managed graph used by automation and snapshots. */
export function applyTreeInput(context, receiver, event, payload, emit = false) {
  if (!['Collapsed', 'ExpansionChanged', 'SelectionChanged'].includes(event)) return false;
  const model = managedTreeModel(context, receiver);
  const identity = reference => context.id?.(reference) ?? reference;
  const nodeFor = reference => model.byReference.get(identity(reference));
  const operation = () => {
    if (event !== 'SelectionChanged') {
      const node = nodeFor(payload.Node);
      if (!node) return false;
      if (event === 'Collapsed' || !payload.IsExpanded) model.collapse(node);
      else model.expand(node);
      context.write(node.reference, 'IsExpanded', model.expanded.has(node));
      return true;
    }
    if (!Array.isArray(payload.SelectedNodes)) return false;
    const nodes = payload.SelectedNodes.map(nodeFor);
    if (nodes.some(node => !node)) throw new TypeError('Tree selection contains an unowned node');
    const previous = [...model.selected];
    model.selected = new Set(nodes);
    model.checkStates = null;
    payload.AddedItems = nodes.filter(node => !previous.includes(node)).map(node => node.Content);
    payload.RemovedItems = previous.filter(node => !model.selected.has(node)).map(node => node.Content);
    context.write(receiver, 'SelectedNodes', context.collection(nodes.map(node => node.reference), CONTROLS + 'ItemCollection'));
    context.write(receiver, 'SelectedItems', context.collection(nodes.map(node => node.Content), CONTROLS + 'ItemCollection'));
    context.write(receiver, 'SelectedNode', nodes[0]?.reference ?? null);
    context.write(receiver, 'SelectedItem', nodes[0]?.Content ?? null);
    if (emit) model.emit('SelectionChanged', payload);
    return true;
  };
  return emit ? operation() : model.silence(operation);
}
