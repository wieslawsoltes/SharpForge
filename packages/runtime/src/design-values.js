import {MEDIA, XAML} from '@sharpforge/framework';
import {normalizeProperty, propertySchema} from '@sharpforge/designer';

/** Convert a validated designer scalar/value record to the existing managed framework representation. */
export function designManagedValue(platform, value, type) {
  if (value === null) return null;
  if (type === XAML + 'Thickness' || type === XAML + 'CornerRadius') {
    const keys = type.endsWith('Thickness') ? ['Left', 'Top', 'Right', 'Bottom'] :
      ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
    return platform.construct(type, keys.map(key => platform.managed(value[key], 'double')));
  }
  if (type === MEDIA + 'Brush' || type === MEDIA + 'SolidColorBrush') {
    if (value.valueType !== MEDIA + 'SolidColorBrush') throw new TypeError('Live properties require a supported solid brush');
    const color = platform.make('Windows.UI.Color', Object.fromEntries(['A', 'R', 'G', 'B'].map(key => [key, value.Color[key]])));
    platform.heap.pins.push(color);
    const brush = platform.construct(MEDIA + 'SolidColorBrush', [color]);
    if (value.Opacity !== undefined) {
      platform.heap.withRoots([brush], () => platform.setProperty(brush, {
        owner: MEDIA + 'SolidColorBrush', property: 'Opacity'
      }, platform.managed(value.Opacity, 'double')));
    }
    return brush;
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
