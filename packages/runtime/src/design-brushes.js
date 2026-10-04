import {MEDIA} from '@sharpforge/framework';

function colorValue(platform, color) {
  const value = platform.make('Windows.UI.Color', Object.fromEntries(['A', 'R', 'G', 'B'].map(name => [name, color[name]])));
  platform.heap.pins.push(value);
  return value;
}

function setValue(platform, reference, property, value) {
  return platform.heap.withRoots([reference, value], () => platform.setProperty(reference, {
    owner: platform.record(reference).type, property
  }, value));
}

/** Materialize a validated closed brush using the same registered construction/property/collection operations as C#. */
export function designManagedBrush(platform, value) {
  platform.valueConstructionDepth = (platform.valueConstructionDepth ?? 0) + 1;
  try { return constructBrush(platform, value); }
  finally { platform.valueConstructionDepth--; }
}

function constructBrush(platform, value) {
  let brush;
  if (value.valueType === MEDIA + 'SolidColorBrush') {
    brush = platform.construct(value.valueType, [colorValue(platform, value.Color)]);
  } else if (value.valueType === MEDIA + 'LinearGradientBrush') {
    brush = platform.construct(value.valueType, []);
    for (const name of ['StartPoint', 'EndPoint']) {
      const point = platform.construct('Windows.Foundation.Point', ['X', 'Y'].map(key => platform.managed(value[name][key], 'double')));
      setValue(platform, brush, name, point);
    }
    const stops = platform.getProperty(brush, {owner: MEDIA + 'GradientBrush', property: 'GradientStops',
      result: MEDIA + 'GradientStopCollection'});
    for (const item of value.GradientStops) {
      const stop = platform.construct(MEDIA + 'GradientStop', []);
      setValue(platform, stop, 'Color', colorValue(platform, item.Color));
      setValue(platform, stop, 'Offset', platform.managed(item.Offset, 'double'));
      platform.collection(stops, 'Add', [stop]);
    }
  } else {
    throw new TypeError('Live properties require a registered solid or linear gradient brush');
  }
  if (value.Opacity !== undefined) setValue(platform, brush, 'Opacity', platform.managed(value.Opacity, 'double'));
  return brush;
}
