/** Native WinUI window resize metadata; these contracts follow A18's released attached-property getters. */
export function registerDesignerViewport({define, prop, delegate, event, XAML}) {
  const size = 'Windows.Foundation.Size';
  const args = XAML + 'WindowSizeChangedEventArgs';
  const handler = 'Windows.Foundation.TypedEventHandler`2<object, ' + args + '>';
  define(size, {kind: 'value', base: 'System.ValueType', slots: ['Width', 'Height']});
  prop(size, 'Width', 'double', 0, true);
  prop(size, 'Height', 'double', 0, true);
  define(args, {kind: 'object', isSealed: true});
  prop(args, 'Size', size, null, true);
  prop(args, 'Handled', 'bool', false);
  delegate(handler, ['object', args]);
  event(XAML + 'Window', 'SizeChanged', handler);
}
