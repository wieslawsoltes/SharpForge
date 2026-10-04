import {ManagedFault, isReference} from '../heap.js';

const reorderProperties = new Set(['Items', 'TabItems', 'MenuItems']);

/** Host reordering can permute an existing collection; it cannot inject arbitrary new managed objects. */
export function applyManagedCollectionInput(context, owner, property, values) {
  if (!reorderProperties.has(property) || !Array.isArray(values) || values.length > 100000) {
    throw new ManagedFault('ArgumentException', 'Invalid collection input');
  }
  const collection = context.read(owner, property);
  if (!collection) throw new ManagedFault('InvalidOperationException', 'The target collection is unavailable');
  const current = context.items(collection);
  if (current.length !== values.length) throw new ManagedFault('ArgumentException', 'Collection input omitted items');
  const identities = new Map(), scalars = new Map();
  for (const item of current) {
    const record = isReference(item) ? context.platform.heap.get(item) : null;
    const objects = record && !['string', 'box'].includes(record.kind);
    const map = objects ? identities : scalars;
    const key = objects ? context.id(item) : context.native(item);
    let bucket = map.get(key);
    if (!bucket) { bucket = {items: [], next: 0}; map.set(key, bucket); }
    bucket.items.push(item);
  }
  const ordered = values.map(value => {
    const bucket = value?.$ref ? identities.get(value.$ref) : scalars.get(value);
    if (!bucket || bucket.next >= bucket.items.length) {
      throw new ManagedFault('ArgumentException', 'Collection input is not a permutation of existing items');
    }
    return bucket.items[bucket.next++];
  });
  const model = context.model(collection);
  if (model?.replaceAll) model.replaceAll(ordered);
  else if (context.platform.heap.get(collection).kind === 'collection') context.platform.replaceItems(collection, ordered);
  else throw new ManagedFault('NotSupportedException', 'This collection does not support authoritative reordering');
  return true;
}
