import {collectionModelFor} from './collection-model.js';

const reorderProperties = new Set(['Items', 'TabItems', 'MenuItems']);

/** Host reordering can permute current values; it cannot create values or replace object identities. */
export function applyFacadeCollectionInput(context, owner, property, values) {
  if (!reorderProperties.has(property) || !Array.isArray(values) || values.length > 100000) throw new TypeError('Invalid collection input');
  context.id(owner);
  const collection = context.read(owner, property);
  if (!collection) throw new TypeError('The collection owner has no such collection');
  const current = context.items(collection);
  if (current.length !== values.length) throw new TypeError('Collection input omitted items');
  const identities = new Map(), scalars = new Map();
  for (const item of current) {
    const map = item?.$node ? identities : scalars;
    const key = item?.$node ? context.id(item) : item;
    let bucket = map.get(key);
    if (!bucket) { bucket = {items: [], next: 0}; map.set(key, bucket); }
    bucket.items.push(item);
  }
  const ordered = values.map(value => {
    const bucket = value?.$ref ? identities.get(value.$ref) : value?.$node ? identities.get(context.id(value)) : scalars.get(value);
    if (!bucket || bucket.next >= bucket.items.length) throw new TypeError('Collection input is not a permutation of existing items');
    return bucket.items[bucket.next++];
  });
  const model = collectionModelFor(context, collection);
  context.sceneJournal?.captureModel(model);
  const replace = model.replaceAll ?? model.ReplaceAll ?? model.Reset;
  if (typeof replace !== 'function') throw new TypeError('The collection cannot accept authoritative reordering');
  replace.call(model, ordered);
  return true;
}
