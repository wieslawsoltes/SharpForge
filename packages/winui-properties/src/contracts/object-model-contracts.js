import {resourceContractHelpers} from './resource-contract-helpers.js';
import {builtInRoutedEvents} from '../object-model/routed-event-registry.js';

/** Additive signatures follow Windows App SDK 1.8 projections; host services determine target support. */
export function registerObjectModelContracts(registry) {
  const {type, method, property, constructor, event} = resourceContractHelpers(registry);
  const x = registry.XAML;
  const dispatch = 'Microsoft.UI.Dispatching.';
  const delegate = (name, parameters) => {
    type(name, {kind: 'delegate', parameters, result: 'void', base: 'System.MulticastDelegate'});
    constructor(name, ['object', 'nint']);
    method(name, 'Invoke', parameters, 'void');
    return name;
  };
  const handler = delegate(dispatch + 'DispatcherQueueHandler', []);
  type(dispatch + 'DispatcherQueuePriority', {kind: 'enum', base: 'System.Enum', values: {Low: -10, Normal: 0, High: 10}});
  type(dispatch + 'DispatcherQueue', {kind: 'object'});
  property(dispatch + 'DispatcherQueue', 'HasThreadAccess', 'bool', false, true);
  method(dispatch + 'DispatcherQueue', 'GetForCurrentThread', [], dispatch + 'DispatcherQueue', {isStatic: true});
  method(dispatch + 'DispatcherQueue', 'TryEnqueue', [handler], 'bool');
  method(dispatch + 'DispatcherQueue', 'TryEnqueue', [dispatch + 'DispatcherQueuePriority', handler], 'bool');
  property(x + 'DependencyObject', 'DispatcherQueue', dispatch + 'DispatcherQueue', null, true);

  type(x + 'RoutedEvent', {kind: 'object'});
  method(x + 'UIElement', 'AddHandler', [x + 'RoutedEvent', 'object', 'bool'], 'void');
  method(x + 'UIElement', 'RemoveHandler', [x + 'RoutedEvent', 'object'], 'void');
  for (const name of builtInRoutedEvents) property(x + 'UIElement', name + 'Event', x + 'RoutedEvent', null, true, true);

  const helper = x + 'Media.VisualTreeHelper';
  const sequence = 'System.Collections.Generic.IEnumerable<' + x + 'UIElement>';
  type(sequence, {kind: 'interface', element: x + 'UIElement'});
  type(helper, {kind: 'static'});
  method(helper, 'GetParent', [x + 'DependencyObject'], x + 'DependencyObject', {isStatic: true});
  method(helper, 'GetChild', [x + 'DependencyObject', 'int'], x + 'DependencyObject', {isStatic: true});
  method(helper, 'GetChildrenCount', [x + 'DependencyObject'], 'int', {isStatic: true});
  for (const geometry of ['Windows.Foundation.Point', 'Windows.Foundation.Rect']) {
    method(helper, 'FindElementsInHostCoordinates', [geometry, x + 'UIElement'], sequence, {isStatic: true});
    method(helper, 'FindElementsInHostCoordinates', [geometry, x + 'UIElement', 'bool'], sequence, {isStatic: true});
  }
  property(x + 'FrameworkElement', 'Parent', x + 'DependencyObject', null, true);
  for (const name of ['MeasureOverride', 'ArrangeOverride']) {
    method(x + 'FrameworkElement', name, ['Windows.Foundation.Size'], 'Windows.Foundation.Size',
      {isVirtual: true, accessibility: 'protected'});
  }
  type(x + 'FlowDirection', {kind: 'enum', base: 'System.Enum', values: {LeftToRight: 0, RightToLeft: 1}});
  for (const [name, valueType, value] of [
    ['FlowDirection', x + 'FlowDirection', 0], ['Language', 'string', 'en-US'], ['AllowFocusOnInteraction', 'bool', true],
    ['FocusVisualPrimaryBrush', x + 'Media.Brush', null], ['FocusVisualSecondaryBrush', x + 'Media.Brush', null],
    ['FocusVisualPrimaryThickness', x + 'Thickness', null], ['FocusVisualSecondaryThickness', x + 'Thickness', null],
    ['FocusVisualMargin', x + 'Thickness', null]
  ]) property(x + 'FrameworkElement', name, valueType, value);
  type(x + 'SizeChangedEventArgs', {kind: 'object', base: x + 'RoutedEventArgs'});
  property(x + 'SizeChangedEventArgs', 'PreviousSize', 'Windows.Foundation.Size', null, true);
  property(x + 'SizeChangedEventArgs', 'NewSize', 'Windows.Foundation.Size', null, true);
  event(x + 'FrameworkElement', 'SizeChanged', delegate(x + 'SizeChangedEventHandler', ['object', x + 'SizeChangedEventArgs']));
  type(x + 'DataContextChangedEventArgs', {kind: 'object'});
  property(x + 'DataContextChangedEventArgs', 'NewValue', 'object', null, true);
  property(x + 'DataContextChangedEventArgs', 'Handled', 'bool', false);
  type(x + 'EffectiveViewportChangedEventArgs', {kind: 'object'});
  for (const name of ['EffectiveViewport', 'MaxViewport']) property(x + 'EffectiveViewportChangedEventArgs', name, 'Windows.Foundation.Rect', null, true);
  for (const name of ['BringIntoViewDistanceX', 'BringIntoViewDistanceY']) {
    property(x + 'EffectiveViewportChangedEventArgs', name, 'double', 0, true);
  }
  for (const [name, argument] of [['Loading', 'object'], ['DataContextChanged', x + 'DataContextChangedEventArgs'],
    ['EffectiveViewportChanged', x + 'EffectiveViewportChangedEventArgs']]) {
    const nameOfDelegate = 'Windows.Foundation.TypedEventHandler<' + x + 'FrameworkElement,' + argument + '>';
    event(x + 'FrameworkElement', name, delegate(nameOfDelegate, [x + 'FrameworkElement', argument]));
  }
  event(x + 'FrameworkElement', 'LayoutUpdated', delegate('System.EventHandler<object>', ['object', 'object']));
}
