import {ValueSource} from '@sharpforge/winui-properties';
import {frameworkType, propertiesFor, CONTROLS, MEDIA, THREAD} from '@sharpforge/framework';
import {refreshStyle, refreshStyles, templateChanged, updateBindings} from '../styling.js';
import {ManagedFault, isReference} from '../heap.js';

const equals = (left, right) => left === right
  || isReference(left) && isReference(right) && left.h === right.h && left.g === right.g;

/** Both interpreters use the package's shared property validator and metadata table. */
export function validateObjectProperty(platform, reference, name, value, definition) {
  const services = platform.ui.properties;
  const property = definition ?? services.lookup(reference, name);
  if (property.readOnly) throw new ManagedFault('InvalidOperationException', `Property '${name}' is read-only`);
  services.storeFor(reference).validateValue(property, services.toNative(value, property.propertyType), {coerce: false});
  return property;
}

function updateContentParent(platform, reference, name, value) {
  if (name !== 'Content' && name !== 'Child') return;
  const previous = platform.get(reference, name);
  if (equals(previous, value)) return;
  if (isReference(value) && platform.isElement(value)) platform.parent(value, reference);
  if (isReference(previous) && platform.isElement(previous)) {
    platform.ui.setVisualParent(previous, null);
  }
}

function updateLegacySelection(platform, reference, value) {
  const type = platform.record(reference).type;
  const property = type === CONTROLS + 'NavigationView' ? 'MenuItems' : type === CONTROLS + 'TabView' ? 'TabItems' : 'Items';
  const list = platform.get(reference, property);
  const items = list ? platform.items(list) : [];
  const index = platform.native(value);
  platform.set(reference, 'SelectedItem', index >= 0 && index < items.length ? items[index] : null);
}

/** Apply public setters through the effective-value store and existing template/style seams. */
export function setObjectProperty(platform, reference, descriptor, value) {
  if (reference?.byref) reference = platform.vm.dereference(reference);
  if (descriptor.owner === THREAD) return platform.vm.scheduler.invoke(descriptor, [reference, value]);
  const property = validateObjectProperty(platform, reference, descriptor.property, value, descriptor.dependencyProperty);
  const type = platform.record(reference).type;
  const kind = frameworkType(type)?.kind;
  const styleChange = ['Style', 'Template'].includes(property.name) || ['style', 'setter', 'template'].includes(kind);
  if (!platform.styleDepth && styleChange) {
    return platform.styleMutation(() => setObjectProperty(platform, reference, descriptor, value));
  }
  updateContentParent(platform, reference, property.name, value);
  platform.set(reference, '$local:' + property.name, true);
  platform.ui.properties.setSource(reference, property, ValueSource.Local, value);
  if (property.name === 'Style') refreshStyle(platform, reference);
  if (property.name === 'Template') templateChanged(platform, reference);
  updateBindings(platform, reference, property);
  if (kind === 'style' || kind === 'setter') refreshStyles(platform, reference);
  if (property.name === 'SelectedIndex' && platform.ui.propertiesFor(type).SelectedItem) updateLegacySelection(platform, reference, value);
  return null;
}
