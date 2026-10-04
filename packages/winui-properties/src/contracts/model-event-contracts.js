import {resourceContractHelpers} from './resource-contract-helpers.js';

/** Every model event uses its real WinUI delegate signature, including the closed generic arguments. */
export function resourceDelegate(registry, name, parameters) {
  const {type, constructor, method} = resourceContractHelpers(registry);
  type(name, {kind: 'delegate', base: 'System.MulticastDelegate', parameters, result: 'void'});
  constructor(name, ['object', 'nint']);
  method(name, 'Invoke', parameters, 'void');
  return name;
}

export function registerItemEventContracts(registry) {
  const {XAML: x, CONTROLS: controls} = registry;
  const {type, method, property, event} = resourceContractHelpers(registry);
  const args = controls + 'ContainerContentChangingEventArgs';
  type(args, {kind: 'object'});
  for (const [name, valueType, value] of [['Item', 'object', null], ['ItemContainer', controls + 'ListViewItem', null],
    ['ItemIndex', 'int', -1], ['Phase', 'uint', 0], ['InRecycleQueue', 'bool', false]]) property(args, name, valueType, value, true);
  property(args, 'Handled', 'bool', false);
  type(controls + 'ListViewBase', {kind: 'control', base: controls + 'Primitives.Selector'});
  const handler = resourceDelegate(registry, 'Windows.Foundation.TypedEventHandler<' + controls + 'ListViewBase,' + args + '>',
    [controls + 'ListViewBase', args]);
  for (const owner of [controls + 'ListView', controls + 'ListViewBase']) event(owner, 'ContainerContentChanging', handler);
  method(args, 'RegisterUpdateCallback', [handler], 'void');
  method(args, 'RegisterUpdateCallback', ['uint', handler], 'void');
  const data = x + 'Data.';
  type(data + 'CurrentChangingEventArgs', {kind: 'object'});
  property(data + 'CurrentChangingEventArgs', 'Cancel', 'bool', false);
  property(data + 'CurrentChangingEventArgs', 'IsCancelable', 'bool', true, true);
  const current = resourceDelegate(registry, data + 'CurrentChangingEventHandler', ['object', data + 'CurrentChangingEventArgs']);
  event(data + 'ICollectionView', 'CurrentChanging', current);
  event(data + 'ICollectionView', 'CurrentChanged', resourceDelegate(registry, 'System.EventHandler<object>', ['object', 'object']));
}

export function registerVisualStateEventContracts(registry) {
  const {XAML: x, CONTROLS: controls} = registry;
  const {type, property, event} = resourceContractHelpers(registry);
  type(x + 'VisualStateChangedEventArgs', {kind: 'object'});
  property(x + 'VisualStateChangedEventArgs', 'OldState', x + 'VisualState');
  property(x + 'VisualStateChangedEventArgs', 'NewState', x + 'VisualState');
  property(x + 'VisualStateChangedEventArgs', 'Control', controls + 'Control');
  const handler = resourceDelegate(registry, x + 'VisualStateChangedEventHandler', ['object', x + 'VisualStateChangedEventArgs']);
  event(x + 'VisualStateGroup', 'CurrentStateChanging', handler);
  event(x + 'VisualStateGroup', 'CurrentStateChanged', handler);
}
