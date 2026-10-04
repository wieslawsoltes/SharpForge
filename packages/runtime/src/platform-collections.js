import {XAML} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';
import {refreshStyles} from './styling.js';
import {validateGradientCollection, refreshExportedFrameworkValue} from './platform-brushes.js';

const sameReference = (left, right) => left === right || isReference(left) && isReference(right)
  && left.h === right.h && left.g === right.g;

/** Replace the bounded managed collection and publish the same owner collection notification. */
export function replacePlatformItems(platform, reference, items) {
  if (items.length > 10000) throw new ManagedFault('OutOfMemoryException', 'UI collection item limit exceeded');
  const data = platform.heap.allocate('array', 'object[]', [...items]);
  platform.heap.withRoots([data], () => platform.set(reference, '$items', data));
  const owner = platform.get(reference, '$owner');
  if (owner) platform.command({op: 'collection', id: `${owner.h}:${owner.g}`, property: platform.get(reference, '$property'),
    items: items.map(value => platform.exportValue(value))});
  refreshExportedFrameworkValue(platform, reference);
}

/** The registered collection methods share bounds and visual-parent rules; brushes add only element validation. */
export function invokePlatformCollection(platform, reference, name, arguments_) {
  const setters = platform.record(reference).type === XAML + 'SetterBaseCollection';
  if (!platform.styleDepth && setters && name !== 'get_Item') {
    return platform.styleMutation(() => invokePlatformCollection(platform, reference, name, arguments_));
  }
  validateGradientCollection(platform, reference, name, arguments_);
  const items = [...platform.items(reference)];
  const owner = platform.get(reference, '$owner');
  let index;
  let removed = [];
  if (name === 'get_Item') {
    index = Number(platform.native(arguments_[0]));
    assertIndex(index, items.length);
    return items[index];
  }
  if (name === 'Add' || name === 'Insert') {
    index = name === 'Add' ? items.length : Number(platform.native(arguments_[0]));
    assertIndex(index, items.length + 1);
    const value = arguments_.at(-1);
    if (owner && isReference(value) && platform.isElement(value)) {
      if (items.some(item => sameReference(item, value))) throw new ManagedFault('InvalidOperationException', 'Duplicate UIElement');
      platform.parent(value, owner);
    }
    items.splice(index, 0, value);
  } else if (name === 'Clear') {
    removed = items.splice(0);
  } else if (name === 'Remove' || name === 'RemoveAt') {
    index = name === 'Remove' ? items.findIndex(item => sameReference(item, arguments_[0])) : Number(platform.native(arguments_[0]));
    if (index < 0 && name === 'Remove') return platform.managed(false, 'bool');
    assertIndex(index, items.length);
    removed = items.splice(index, 1);
  } else {
    throw new ManagedFault('MissingMethodException', name);
  }
  for (const value of removed) if (isReference(value) && platform.isElement(value)) platform.set(value, '$parent', null);
  replacePlatformItems(platform, reference, items);
  if (setters) refreshStyles(platform);
  return name === 'Remove' ? platform.managed(true, 'bool') : null;
}

function assertIndex(index, length) {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new ManagedFault('ArgumentOutOfRangeException', 'Collection index');
  }
}
