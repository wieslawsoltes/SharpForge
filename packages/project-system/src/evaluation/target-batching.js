import { fail, getCaseInsensitive } from './errors.js';
import { getItemMetadata } from './item-metadata.js';

/** Partition items by the metadata consumed by a task/target; all work is bounded by the context budget. */
export function batchInvocations(context, values) {
  const text = values.join(';');
  const references = [...text.matchAll(/%\((?:([A-Za-z_][\w-]*)\.)?([A-Za-z_][\w-]*)\)/g)];
  if (!references.length || context.currentItem) return [null];
  const explicit = new Set(references.map(match => match[1]).filter(Boolean));
  if (!explicit.size) {
    const itemTypes = [...text.matchAll(/@\(([A-Za-z_][\w-]*)/g)].map(match => match[1]);
    if (new Set(itemTypes).size !== 1) fail('Unqualified batching metadata requires a uniquely identifiable item list.', 'MSB4096');
    explicit.add(itemTypes[0]);
  }
  const metadataNames = [...new Set(references.map(match => match[2].toLowerCase()))];
  const buckets = new Map();
  for (const type of explicit) {
    for (const item of getCaseInsensitive(context.items, type) ?? []) {
      context.step();
      const key = JSON.stringify(metadataNames.map(name => getItemMetadata(item, name, context)));
      if (!buckets.has(key)) buckets.set(key, { items: Object.create(null), representative: item });
      const list = buckets.get(key).items[type] ??= [];
      list.push(item);
    }
  }
  return [...buckets.values()].map(bucket => ({ ...bucket, types: explicit }));
}

export function withBatch(context, batch, action) {
  if (!batch) return action();
  const previous = context.items;
  const previousBatch = context.batchItems;
  context.items = { ...previous };
  context.batchItems = batch.items;
  for (const type of batch.types) {
    const key = Object.keys(context.items).find(key => key.toLowerCase() === type.toLowerCase()) ?? type;
    context.items[key] = batch.items[type] ?? [];
  }
  try { return context.withItem(batch.representative, action); }
  finally {
    for (const [type, list] of Object.entries(context.items)) {
      if (![...batch.types].some(name => name.toLowerCase() === type.toLowerCase())) previous[type] = list;
    }
    context.items = previous;
    context.batchItems = previousBatch;
  }
}
