const actions = new Set(['Add', 'Remove', 'Replace', 'Move', 'Reset']);
const maximumItems = 1000000;
const insertionBatch = 2048;

function items(value, required = false) {
  if (value == null && !required) return [];
  if (!Array.isArray(value) || value.length > maximumItems) throw new TypeError('SFUI1670: Invalid collection change items');
  return value;
}
function index(value, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError('SFUI1670: Collection change index is outside the range');
  return value;
}
function insert(target, at, values) {
  for (let first = 0; first < values.length; first += insertionBatch) {
    target.splice(at + first, 0, ...values.slice(first, first + insertionBatch));
  }
}
const equal = (a, b) => Object.is(a, b) || a?.$ref != null && a.$ref === b?.$ref;

/** Applies observable collection deltas in place; all bounds are checked before the first write. */
export function applyCollectionChange(node, property, change) {
  if (!node || typeof property !== 'string' || !property || property.length > 256 || ['__proto__', 'prototype', 'constructor'].includes(property)) {
    throw new TypeError('SFUI1670: Invalid collection owner/property');
  }
  if (!change || !actions.has(change.action)) throw new TypeError('SFUI1670: Unknown collection change action');
  const current = node.collections?.[property] ?? [];
  if (!Array.isArray(current) || current.length > maximumItems) throw new TypeError('SFUI1670: Invalid existing collection');
  const next = [...items(change.NewItems)], old = [...items(change.OldItems)];
  let at = 0, remove = 0, from = 0;
  if (change.action === 'Add') at = index(change.NewStartingIndex, current.length);
  if (['Remove', 'Replace', 'Move'].includes(change.action)) {
    from = index(change.OldStartingIndex, current.length);
    remove = old.length;
    if (!remove || from + remove > current.length) throw new RangeError('SFUI1670: Invalid removed item span');
    for (let n = 0; n < remove; n++) if (!equal(current[from + n], old[n])) throw new TypeError('SFUI1670: Stale collection change');
    at = change.action === 'Move' ? index(change.NewStartingIndex, current.length - remove) : from;
    if (change.action === 'Replace' && change.NewStartingIndex !== from) throw new TypeError('SFUI1670: Replacement indices must match');
  }
  const added = change.action === 'Move' ? old : change.action === 'Remove' ? [] : next;
  const count = change.action === 'Reset' ? next.length : current.length - remove + added.length;
  if (count > maximumItems) throw new RangeError('SFUI1670: Collection item limit exceeded');
  if (change.version != null && (!Number.isSafeInteger(change.version) || change.version < 0)) {
    throw new TypeError('SFUI1670: Invalid collection version');
  }
  const previous = node.collectionVersions?.[property];
  if (previous != null && change.version != null && change.version <= previous) throw new TypeError('SFUI1670: Stale collection version');
  const target = Object.isFrozen(current) || !Object.isExtensible(current) ? [...current] : current;
  if (change.action === 'Reset') { target.length = 0; insert(target, 0, next); }
  else { if (remove) target.splice(from, remove); insert(target, at, added); }
  node.collections ??= Object.create(null);
  node.collections[property] = target;
  node.collectionVersions ??= Object.create(null);
  if (change.version != null) node.collectionVersions[property] = change.version;
  return target;
}
