/** Closed linear-gradient contracts follow the viewport contribution in A18's reserved ABI block. */
export function registerDesignerGradients({define, ctor, prop, member, XAML, MEDIA}) {
  const point = 'Windows.Foundation.Point';
  const stop = MEDIA + 'GradientStop';
  const collection = MEDIA + 'GradientStopCollection';
  const gradient = MEDIA + 'GradientBrush';
  const linear = MEDIA + 'LinearGradientBrush';
  define(point, {kind: 'value', slots: ['X', 'Y'], base: 'System.ValueType'});
  ctor(point, ['double', 'double']);
  prop(point, 'X', 'double', 0, true);
  prop(point, 'Y', 'double', 0, true);
  define(stop, {kind: 'object', base: XAML + 'DependencyObject'});
  ctor(stop);
  prop(stop, 'Color', 'Windows.UI.Color');
  prop(stop, 'Offset', 'double', 0);
  define(collection, {kind: 'collection'});
  ctor(collection);
  prop(collection, 'Count', 'int', 0, true);
  member(collection, 'Add', [stop], 'void');
  member(collection, 'Clear', [], 'void');
  member(collection, 'Remove', [stop], 'bool');
  member(collection, 'RemoveAt', ['int'], 'void');
  member(collection, 'Insert', ['int', stop], 'void');
  member(collection, 'get_Item', ['int'], stop);
  define(gradient, {kind: 'abstract', base: MEDIA + 'Brush'});
  prop(gradient, 'GradientStops', collection);
  define(linear, {kind: 'brush', base: gradient});
  ctor(linear);
  prop(linear, 'StartPoint', point);
  prop(linear, 'EndPoint', point);
}
