import { ControlError } from './events.js';

/** Commit a replacement through the managed collection channel before raising completion events. */
export function replaceControlItems(context, node, property, items) {
  const current = node.properties[property];
  if (context.collectionInput) {
    if (context.collectionInput(node, property, items) !== true) {
      throw new ControlError('SFUI1608', 'The collection owner rejected the item replacement', { property });
    }
  } else if (current?.$ref) {
    throw new ControlError('SFUI1608', 'A managed collection requires an authoritative input channel', { property });
  }
  if (Array.isArray(current)) node.properties[property] = items;
  else node.collections[property] = items;
  node.properties.ItemsRevision = (node.properties.ItemsRevision ?? 0) + 1;
  context.invalidate(node.id);
}
