import {frameworkType, propertiesFor, XAML} from '@sharpforge/framework';
import {managedUIProperties} from './object-storage.js';

/** CLR dependency-property getters observe the same effective value as DependencyObject.GetValue. */
export function readManagedUIProperty(platform, reference, descriptor) {
  const record = platform.record(reference);
  const name = descriptor.property;
  if (name === 'Count' && record.kind === 'collection') return platform.items(reference).length;
  const definition = managedUIProperties(platform, record.type)[name];
  const resultType = descriptor.result ?? definition?.type;
  let value = platform.get(reference, name, undefined);
  if (frameworkType(resultType)?.kind === 'collection') {
    if (value === null || value === undefined) {
      value = platform.make(resultType, {}, 'collection');
      platform.heap.withRoots([reference, value], () => {
        platform.set(reference, name, value);
        platform.set(value, '$owner', reference);
        platform.set(value, '$property', name);
      });
    }
    return value;
  }
  if (definition && platform.ui.properties.assignable(XAML + 'DependencyObject', record.type)) {
    const property = platform.ui.propertyRegistry.lookup(record.type, name);
    if (property) return platform.ui.properties.read(reference, property);
  }
  return value ?? null;
}
