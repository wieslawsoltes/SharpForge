import {frameworkType} from '@sharpforge/framework';
import {collectionModelFor, invokeCollectionOperation} from './collection-model.js';
export {adopt, release} from './visual-parent.js';
export {invokeCollectionOperation};
export {applyFacadeCollectionInput} from './collection-input.js';

/** Collection properties have normal framework identities, shared event methods, and one owner model. */
export function createUIObjectCollection(context, owner, property) {
  const definition = context.propertiesFor(context.typeOf(owner))[property];
  if (!definition || frameworkType(definition.type)?.kind !== 'collection') throw new TypeError('The property is not a registered collection');
  context.sceneJournal?.captureObject(owner);
  const receiver = context.allocate(definition.type);
  collectionModelFor(context, receiver, {owner, property});
  return receiver;
}

export function invokeFacadeCollection(context, receiver, descriptor, args) {
  if (!receiver?.$node || frameworkType(receiver.$node.type)?.kind !== 'collection') return {handled: false};
  return {handled: true, value: invokeCollectionOperation(context, receiver, descriptor.name, args)};
}
