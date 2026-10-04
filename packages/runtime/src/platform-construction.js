import {frameworkType, propertiesFor, XAML, MEDIA, THREAD} from '@sharpforge/framework';
import {ManagedFault} from './gc/fault.js';
import {isReference} from './gc/reference.js';
import {constructBoundDelegate} from './execution/delegate-targets.js';

function constructFrameworkDelegate(platform, type, args) {
  const [receiver, pointer] = args;
  if (!pointer?.methodPointer) {
    throw new ManagedFault('InvalidProgramException', 'Delegate construction requires a verified method pointer');
  }
  if (platform.vm.inspector) return constructBoundDelegate(platform.vm, type, receiver, pointer);
  // Source images are verified at VM construction and use method indices, not native CIL tokens.
  if (!Number.isSafeInteger(pointer.token) || pointer.token < 0 || !platform.vm.image.methods[pointer.token]) {
    throw new ManagedFault('InvalidProgramException', 'Unknown source delegate target');
  }
  return platform.delegate(type, pointer.token, receiver);
}

/** Caller supplies a temporary-root scope encompassing defaults and object publication. */
export function constructFrameworkObject(platform, type, args) {
  const descriptor = frameworkType(type);
  if (!descriptor) throw new ManagedFault('TypeLoadException', `Unknown framework type ${type}`);
  if (descriptor.kind === 'delegate') {
    return constructFrameworkDelegate(platform, type, args);
  }
  if (type === THREAD) return platform.vm.scheduler.createThread(args[0]);
  const values = {};
  for (const [key, property] of Object.entries(propertiesFor(type))) {
    if (property.isStatic || property.value === null) continue;
    values[key] = platform.managed(property.value, property.type);
    if (isReference(values[key])) platform.heap.pinRoot(values[key]);
  }
  const native = args.map(value => platform.native(value));
  if (type === XAML + 'Thickness' || type === XAML + 'CornerRadius') {
    descriptor.slots.forEach((key, index) => {
      values[key] = platform.managed(args.length === 1 ? native[0] : native[index], 'double');
    });
  }
  if (type === XAML + 'GridLength') {
    if (!Number.isFinite(native[0]) || native[0] < 0) throw new ManagedFault('ArgumentException', 'GridLength must be finite and nonnegative');
    values.Value = platform.managed(native[0], 'double');
    values.GridUnitType = native[1] ?? 1;
  }
  if (type === MEDIA + 'SolidColorBrush') values.Color = args[0] ?? null;
  if (type === XAML + 'Setter' && args.length) {
    values.Property = args[0];
    values.Value = args[1];
  }
  if (type === XAML + 'Style' && args.length) values.TargetTypeName = args[0];
  const reference = platform.make(type, values);
  platform.heap.pinRoot(reference);
  if (descriptor.kind === 'application') {
    if (platform.application) throw new ManagedFault('InvalidOperationException', 'An application already exists');
    platform.heap.writeRoot(platform, 'application', reference);
  }
  platform.command({op: 'create', id: `${reference.h}:${reference.g}`, type, properties: platform.exportProperties(reference)});
  return reference;
}
