import {frameworkType, propertiesFor, XAML, MEDIA, THREAD} from '@sharpforge/framework';
import {ManagedFault, isReference} from './heap.js';
import {constructBoundDelegate} from './execution/delegate-targets.js';
import {initializeGradientValues} from './platform-brushes.js';

/** Construct only registered framework types, rooting nested values before publishing the new object. */
export function constructPlatformObject(platform, type, arguments_) {
  const definition = frameworkType(type);
  if (!definition) throw new ManagedFault('TypeLoadException', `Unknown framework type ${type}`);
  if (definition.kind === 'delegate') return constructBoundDelegate(platform.vm, type, arguments_[0], arguments_[1]);
  if (type === THREAD) return platform.vm.scheduler.createThread(arguments_[0]);
  const values = {};
  for (const [name, property] of Object.entries(propertiesFor(type))) {
    if (property.isStatic || property.value === null) continue;
    values[name] = platform.managed(property.value, property.type);
    if (isReference(values[name])) platform.heap.pins.push(values[name]);
  }
  const native = arguments_.map(value => platform.native(value));
  if (type === XAML + 'Thickness' || type === XAML + 'CornerRadius') {
    definition.slots.forEach((name, index) => {
      values[name] = platform.managed(arguments_.length === 1 ? native[0] : native[index], 'double');
    });
  }
  if (type === XAML + 'GridLength') {
    if (!Number.isFinite(native[0]) || native[0] < 0) {
      throw new ManagedFault('ArgumentException', 'GridLength must be finite and nonnegative');
    }
    values.Value = platform.managed(native[0], 'double');
    values.GridUnitType = native[1] ?? 1;
  }
  if (type === MEDIA + 'SolidColorBrush') values.Color = arguments_[0] ?? null;
  if (type === XAML + 'Setter' && arguments_.length) [values.Property, values.Value] = arguments_;
  if (type === XAML + 'Style' && arguments_.length) values.TargetTypeName = arguments_[0];
  initializeGradientValues(platform, type, arguments_, values);
  const reference = platform.make(type, values, definition.kind === 'collection' ? 'collection' : 'host');
  platform.heap.pins.push(reference);
  if (definition.kind === 'application') {
    if (platform.application) throw new ManagedFault('InvalidOperationException', 'An application already exists');
    platform.application = reference;
  }
  platform.command({op: 'create', id: `${reference.h}:${reference.g}`, type, properties: platform.exportProperties(reference)});
  return reference;
}
