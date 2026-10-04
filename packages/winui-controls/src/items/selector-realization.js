import { itemAt, itemText } from './item-source.js';
import { stateFor, ControlError } from '../policy/events.js';

const maximumSelectorItems = 2048;

export function selectorRealization(context, node, source, indices) {
  if (indices.length > maximumSelectorItems) throw new ControlError('SFUI1603', 'This selector exceeds its 2048-item realization budget');
  const state = stateFor(context, node, 'selector-realization', () => ({ references: new Map(), visualChildren: [] }));
  const records = indices.map(index => ({ index, key: source.keyAt?.(index) ?? index, item: itemAt(source, index) }));
  const provider = context.services.itemContainers;
  provider?.realize?.(node, records);
  const signature = indices.join(',');
  if (!provider?.realize && state.request !== signature && context.host.options.onRealizeItems) {
    state.request = signature;
    context.host.options.onRealizeItems({ id: node.id, indices });
  }
  const published = new Map();
  for (const record of source.records?.values() ?? []) if (record.container) published.set(record.index, record.container);
  for (const reference of node.collections.$itemContainers ?? []) {
    const metadata = reference?.$ref && context.nodes.get(reference.$ref);
    const index = metadata?.properties.$itemIndex;
    if (Number.isInteger(index)) published.set(index, reference);
  }
  state.references = new Map(records.map(record => [record.index,
    provider?.referenceFor?.(node, record.key, record.index) ?? published.get(record.index) ?? record.item]));
  state.visualChildren = [...state.references.values()].map(value => value?.$ref).filter(Boolean);
  return state;
}

export function selectorContent(context, node, element, source, index) {
  const state = stateFor(context, node, 'selector-realization', () => ({ references: new Map(), visualChildren: [] }));
  const content = state.references.get(index) ?? itemAt(source, index);
  if (content?.$ref) context.content(element, content);
  else element.textContent = content === undefined && source.records ? 'Loading…' : itemText(context, content);
}

export function selectorVisualChildren(context, node) {
  return stateFor(context, node, 'selector-realization', () => ({ references: new Map(), visualChildren: [] })).visualChildren;
}
