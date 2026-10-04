import {propertiesFor} from '@sharpforge/framework';
import {childSlot} from '@sharpforge/designer';
import {isReference} from './heap.js';

/** Assign visual children while leaving scalar Items outside managed-parent traversal. */
export function setDesignChildren(platform, reference, children) {
  const type = platform.record(reference).type;
  const slot = childSlot(type);
  if (!slot) {
    if (children.length) throw new Error('Control cannot contain children');
    return;
  }
  if (!slot.many) {
    if (children.length > 1) throw new Error('Content controls accept one child');
    platform.setProperty(reference, {owner: type, property: slot.property}, children[0] ?? null);
    return;
  }
  const result = propertiesFor(type)[slot.property].type;
  const collection = platform.getProperty(reference, {owner: type, property: slot.property, result});
  for (const child of platform.items(collection)) {
    if (isReference(child) && platform.isElement(child)) platform.set(child, '$parent', null);
  }
  for (const child of children) {
    if (isReference(child) && platform.isElement(child)) platform.parent(child, reference);
  }
  platform.replaceItems(collection, children);
}
