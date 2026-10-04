import {MEDIA, XAML} from '@sharpforge/framework';
import {normalizeProperty, propertySchema} from '@sharpforge/designer';
import {designManagedBrush} from './design-brushes.js';

/** Object collection scalars retain their managed primitive type, including Boolean on the CIL engine. */
export function designManagedObjectScalar(platform, value) {
  if (value === null) return null;
  if (typeof value === 'string') return platform.managed(value, 'string');
  if (typeof value === 'boolean') return platform.heap.allocate('box', 'System.Boolean', [platform.managed(value, 'bool')]);
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('A live object scalar must be finite');
  let type = 'System.Double';
  let stored = platform.managed(value, 'double');
  if (Number.isInteger(value) && !String(value).toLowerCase().includes('e')) {
    if (value >= -2147483648 && value <= 2147483647) {
      type = 'System.Int32';
      stored = value;
    } else if (value >= 0 && value <= 4294967295) {
      type = 'System.UInt32';
      stored = value | 0;
    } else if (Number.isSafeInteger(value)) {
      type = 'System.Int64';
      stored = BigInt(value);
    }
  }
  return platform.heap.allocate('box', type, [stored]);
}

/** Convert a validated designer scalar/value record to the existing managed framework representation. */
export function designManagedValue(platform, value, type) {
  if (value === null) return null;
  if (type === 'object') return designManagedObjectScalar(platform, value);
  if (type === XAML + 'Thickness' || type === XAML + 'CornerRadius') {
    const keys = type.endsWith('Thickness') ? ['Left', 'Top', 'Right', 'Bottom'] :
      ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
    return platform.construct(type, keys.map(key => platform.managed(value[key], 'double')));
  }
  if (['Brush', 'SolidColorBrush', 'GradientBrush', 'LinearGradientBrush'].some(name => type === MEDIA + name)) {
    return designManagedBrush(platform, value);
  }
  if (type === XAML + 'GridLength') return platform.construct(type, [platform.managed(value.Value, 'double'), value.GridUnitType]);
  return platform.managed(value, type);
}

/** Assign through the same metadata validation and attached-property path used by ordinary live edits. */
export function assignDesignValue(platform, reference, name, value) {
  const type = platform.record(reference).type;
  const descriptor = propertySchema(type)[name];
  if (!descriptor) throw new TypeError('Unknown property ' + name);
  value = normalizeProperty(type, name, value);
  const managed = designManagedValue(platform, value, descriptor.type);
  platform.heap.withRoots([managed], () => {
    if (descriptor.attached) {
      platform.set(reference, '$' + name, managed);
      platform.command({op: 'set', id: `${reference.h}:${reference.g}`, property: name, value});
    } else platform.setProperty(reference, {owner: type, property: name}, managed);
  });
}
