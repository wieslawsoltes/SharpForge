import {XAML} from '@sharpforge/framework';
import {ManagedFault, isReference} from '../heap.js';
import {refreshStyles} from '../styling.js';
import {assertManagedCollectionParent, isManagedCollectionChild, setManagedCollectionParent} from './tree-services.js';

const same = (left, right) => left === right
  || isReference(left) && isReference(right) && left.h === right.h && left.g === right.g;
const actions = Object.freeze({Add: 0, Remove: 1, Replace: 2, Move: 3, Reset: 4});
const vectorActions = Object.freeze({Add: 1, Remove: 2, Replace: 3, Move: 0, Reset: 0});

function indexOf(platform, value, length, allowEnd = false) {
  const index = Number(platform.native(value));
  if (!Number.isSafeInteger(index) || index < 0 || index >= length + Number(allowEnd)) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Collection index');
  }
  return index;
}

function collectionChange(reference, version, specification) {
  const {action, index = -1, oldIndex = -1, items = [], oldItems = []} = specification;
  return Object.freeze({source: reference, version, action, Action: actions[action],
    NewStartingIndex: index, OldStartingIndex: oldIndex, NewItems: Object.freeze([...items]), OldItems: Object.freeze([...oldItems]),
    CollectionChange: vectorActions[action], Index: Math.max(0, index < 0 ? oldIndex : index)});
}

function validateItems(platform, reference, values) {
  const maximum = platform.options.maxUIArrayElements ?? 1000000;
  if (!Array.isArray(values) || values.length > maximum) throw new ManagedFault('OutOfMemoryException', 'UI collection item limit exceeded');
  const owner = platform.get(reference, '$owner');
  if (!owner) return;
  if (platform.get(reference, '$property') === 'Items') platform.ui.assertItemsWritable?.(owner);
  const seen = new Set();
  for (const value of values) {
    if (!isManagedCollectionChild(platform.ui, value)) continue;
    const id = platform.ui.id(value);
    if (seen.has(id)) throw new ManagedFault('InvalidOperationException', 'Duplicate UI or text element');
    seen.add(id);
    assertManagedCollectionParent(platform.ui, value, owner);
  }
}

function updateParents(platform, reference, previous, values) {
  const owner = platform.get(reference, '$owner');
  if (!owner) return;
  const retained = new Set(values.filter(value => isManagedCollectionChild(platform.ui, value)).map(value => platform.ui.id(value)));
  for (const value of previous) {
    if (isManagedCollectionChild(platform.ui, value) && !retained.has(platform.ui.id(value)) && same(platform.get(value, '$parent'), owner)) {
      setManagedCollectionParent(platform.ui, value, null);
    }
  }
  for (const value of values) if (isManagedCollectionChild(platform.ui, value)) setManagedCollectionParent(platform.ui, value, owner);
}

function publishChange(platform, reference, values, change) {
  const owner = platform.get(reference, '$owner'), property = platform.get(reference, '$property');
  if (owner) {
    platform.ui.layoutTemplates.collectionChanged(owner, property);
    if (property === 'GroupStyle') platform.ui.itemsChanged?.(owner);
    if (property === 'Items') platform.ui.itemsCollectionChanged?.(owner, values, {action: change.action,
      index: change.NewStartingIndex < 0 ? change.OldStartingIndex : change.NewStartingIndex,
      items: change.NewItems, count: change.OldItems.length, oldIndex: change.OldStartingIndex, newIndex: change.NewStartingIndex});
    if (property !== 'Items' || !platform.ui.itemScene?.(owner)) {
      const {source, ...data} = change;
      platform.command({op: 'collectionChange', id: platform.ui.id(owner), property, change: {...data,
        NewItems: change.NewItems.map(value => platform.exportValue(value)), OldItems: change.OldItems.map(value => platform.exportValue(value))}});
    }
  }
  platform.ui.vectorChanged?.(reference, change);
}

/** Array replacement is the single commit point for collection versions, ownership and observable deltas. */
export function replaceManagedItems(platform, reference, values, specification = null) {
  validateItems(platform, reference, values);
  const previous = platform.items(reference);
  const version = platform.get(reference, '$version', 0) + 1;
  const change = collectionChange(reference, version, specification ?? {action: 'Reset', items: values, oldItems: previous});
  return platform.heap.withRoots([reference, ...previous, ...values], () => {
    const data = platform.heap.allocate('array', 'object[]', [...values]);
    platform.heap.pins.push(data);
    updateParents(platform, reference, previous, values);
    platform.set(reference, '$items', data);
    platform.set(reference, '$version', version);
    publishChange(platform, reference, values, change);
    return change;
  });
}

function mutation(platform, reference, name, args) {
  const items = [...platform.items(reference)];
  let change, result = null;
  if (name === 'Add' || name === 'Insert') {
    const index = name === 'Add' ? items.length : indexOf(platform, args[0], items.length, true);
    const value = args.at(-1);
    items.splice(index, 0, value);
    change = {action: 'Add', index, items: [value]};
  } else if (name === 'Remove' || name === 'RemoveAt') {
    const index = name === 'Remove' ? items.findIndex(value => same(value, args[0])) : indexOf(platform, args[0], items.length);
    if (index < 0) return platform.managed(false, 'bool');
    change = {action: 'Remove', oldIndex: index, oldItems: items.splice(index, 1)};
    if (name === 'Remove') result = platform.managed(true, 'bool');
  } else if (name === 'set_Item') {
    const index = indexOf(platform, args[0], items.length);
    change = {action: 'Replace', index, oldIndex: index, items: [args[1]], oldItems: items.splice(index, 1, args[1])};
  } else if (name === 'Move') {
    const oldIndex = indexOf(platform, args[0], items.length), index = indexOf(platform, args[1], items.length);
    if (oldIndex === index) return null;
    const [value] = items.splice(oldIndex, 1);
    items.splice(index, 0, value);
    change = {action: 'Move', index, oldIndex, items: [value], oldItems: [value]};
  } else if (name === 'Clear' || name === 'ReplaceAll') {
    const replacement = name === 'Clear' ? [] : [...platform.ui.items(args[0])];
    replaceManagedItems(platform, reference, replacement);
    return null;
  } else throw new ManagedFault('MissingMethodException', name);
  replaceManagedItems(platform, reference, items, change);
  return result;
}

/** Registered vector and released collection methods share one mutation implementation. */
export function invokeManagedCollection(platform, reference, name, args) {
  const items = platform.items(reference);
  if (name === 'get_Item') return items[indexOf(platform, args[0], items.length)];
  if (name === 'Contains') return platform.managed(items.some(value => same(value, args[0])), 'bool');
  if (name === 'IndexOf') return items.findIndex(value => same(value, args[0]));
  const setterCollection = platform.record(reference).type === XAML + 'SetterBaseCollection';
  if (setterCollection && !platform.styleDepth) return platform.styleMutation(() => invokeManagedCollection(platform, reference, name, args));
  const result = mutation(platform, reference, name, args);
  if (setterCollection) refreshStyles(platform, platform.get(reference, '$owner'));
  return result;
}
