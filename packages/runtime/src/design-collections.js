import {frameworkType, propertiesFor} from '@sharpforge/framework';
import {childSlot, normalizeDesignerCollection, normalizeProperty, propertySchema} from '@sharpforge/designer';
import {assignDesignValue, designManagedObjectScalar} from './design-values.js';

const services = Object.freeze({childSlot, normalizeProperty, propertySchema});

function invalid(message) {
  const error = new TypeError(message);
  error.code = 'SFDL0011';
  error.diagnostic = {code: error.code, severity: 'error', source: 'Designer', span: null, message};
  throw error;
}

function validateItems(owner, command) {
  if (command.property !== 'Items' || frameworkType(propertiesFor(owner.type).Items?.type)?.kind !== 'collection') {
    invalid('Only metadata-declared Items collections support a live collection patch');
  }
  const node = {type: owner.type, children: []};
  const items = normalizeDesignerCollection(node, 'Items', command.items, services);
  const previous = command.previous === null ? null : normalizeDesignerCollection(node, 'Items', command.previous, services);
  let size = 0;
  for (const value of [items, previous]) {
    if (value && (size += JSON.stringify(value).length) > 4_000_000) invalid('Live Items patch text limit exceeded');
  }
  return {items, previous};
}

function matchesPrevious(platform, value, expected) {
  if (expected && typeof expected === 'object') {
    if (!value || typeof value !== 'object' || !Number.isInteger(value.h)) return false;
    const record = platform.heap.get(value);
    return record.type === expected.type && (!expected.properties.Name ||
      platform.native(platform.get(value, 'Name')) === expected.properties.Name);
  }
  return platform.exportValue(value) === expected;
}

function itemBuckets(previous) {
  const buckets = new Map();
  previous?.forEach((item, index) => {
    const key = JSON.stringify(item);
    if (!buckets.has(key)) buckets.set(key, {indices: [], next: 0});
    buckets.get(key).indices.push(index);
  });
  return buckets;
}

function createItem(platform, item) {
  if (item === null || typeof item !== 'object') return designManagedObjectScalar(platform, item);
  const reference = platform.construct(item.type, []);
  platform.heap.pins.push(reference);
  for (const [property, value] of Object.entries(item.properties)) assignDesignValue(platform, reference, property, value);
  return reference;
}

/**
 * Materialize closed scalar/property-bag Items inside applyDesignPatch's existing transaction.
 * Unchanged items keep their managed identity through reordering. Changed items are explicit
 * replacements; stale owner contents reject before mutation and all failures roll back atomically.
 */
export function applyDesignCollection(platform, reference, command) {
  const owner = platform.record(reference);
  const {items, previous} = validateItems(owner, command);
  const definition = propertiesFor(owner.type).Items;
  const collection = platform.getProperty(reference, {owner: owner.type, property: 'Items', result: definition.type});
  const existing = platform.items(collection);
  if (previous && (previous.length !== existing.length || previous.some((item, index) => !matchesPrevious(platform, existing[index], item)))) {
    invalid('The live Items collection changed after attachment. Reattach before replacing it.');
  }
  const buckets = itemBuckets(previous);
  const retained = new Map();
  const next = [];
  for (const item of items) {
    const bucket = buckets.get(JSON.stringify(item));
    const index = bucket && bucket.next < bucket.indices.length ? bucket.indices[bucket.next++] : undefined;
    const value = index === undefined ? createItem(platform, item) : existing[index];
    if (index !== undefined) retained.set(index, next.length);
    next.push(value);
    platform.heap.pins.push(value);
  }
  for (let index = 0; index < existing.length; index++) {
    const value = existing[index];
    if (!retained.has(index) && value && typeof value === 'object' && Number.isInteger(value.h) && platform.isElement(value)) {
      platform.set(value, '$parent', null);
    }
  }
  for (const value of next) {
    if (value && typeof value === 'object' && Number.isInteger(value.h) && platform.isElement(value)) platform.parent(value, reference);
  }
  platform.replaceItems(collection, next);
  if (propertiesFor(owner.type).SelectedIndex) {
    const selected = platform.native(platform.get(reference, 'SelectedIndex', -1));
    const index = retained.get(selected) ?? -1;
    platform.setProperty(reference, {owner: owner.type, property: 'SelectedIndex'}, platform.managed(index, 'int'));
  }
}
