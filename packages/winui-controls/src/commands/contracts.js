export function registerCommandContracts(b) {
  const { X, C } = b, I = X + 'Input.';
  b.enumeration(C + 'ClickMode', { Release: 0, Press: 1, Hover: 2 });
  b.type('System.Windows.Input.ICommand', 'object', 'interface', []);
  b.method('System.Windows.Input.ICommand', 'CanExecute', ['object'], 'bool');
  b.method('System.Windows.Input.ICommand', 'Execute', ['object']);
  b.event('System.Windows.Input.ICommand', 'CanExecuteChanged');
  b.type(I + 'XamlUICommand', X + 'DependencyObject');
  b.props(I + 'XamlUICommand', { Label: ['string', ''], Description: ['string', ''], IconSource: 'object',
    AccessKey: ['string', ''], KeyboardAccelerators: [C + 'ItemCollection', null, true], Command: 'System.Windows.Input.ICommand' });
  b.method(I + 'XamlUICommand', 'CanExecute', ['object'], 'bool');
  b.method(I + 'XamlUICommand', 'Execute', ['object']);
  b.method(I + 'XamlUICommand', 'NotifyCanExecuteChanged');
  b.event(I + 'XamlUICommand', 'CanExecuteRequested', { Parameter: 'object', CanExecute: ['bool', true] });
  b.event(I + 'XamlUICommand', 'ExecuteRequested', { Parameter: 'object' });
  b.event(I + 'XamlUICommand', 'CanExecuteChanged');
  b.enumeration(I + 'StandardUICommandKind', { None: 0, Cut: 1, Copy: 2, Paste: 3, SelectAll: 4, Delete: 5,
    Share: 6, Save: 7, Open: 8, Close: 9, Pause: 10, Play: 11, Stop: 12, Forward: 13, Backward: 14, Undo: 15, Redo: 16 });
  b.type(I + 'StandardUICommand', I + 'XamlUICommand', 'object', [[], [I + 'StandardUICommandKind']]);
  b.property(I + 'StandardUICommand', 'Kind', I + 'StandardUICommandKind', 0);
  b.type(I + 'KeyboardAccelerator', X + 'DependencyObject');
  b.props(I + 'KeyboardAccelerator', { Key: ['int', 0], Modifiers: ['int', 0], IsEnabled: ['bool', true], ScopeOwner: X + 'DependencyObject' });
  b.event(I + 'KeyboardAccelerator', 'Invoked', { Handled: ['bool', false], Element: X + 'DependencyObject' });
  b.props(X + 'UIElement', { AccessKey: ['string', ''], IsAccessKeyScope: ['bool', false], AccessKeyScopeOwner: X + 'DependencyObject',
    KeyboardAccelerators: [C + 'ItemCollection', null, true] });
  for (const name of ['AccessKeyInvoked', 'AccessKeyDisplayRequested', 'AccessKeyDisplayDismissed']) b.event(X + 'UIElement', name);
  b.control('Primitives.ButtonBase', C + 'ContentControl');
  for (const name of ['Button', 'ToggleButton', 'CheckBox', 'RadioButton', 'HyperlinkButton', 'RepeatButton',
    'DropDownButton', 'SplitButton', 'ToggleSplitButton', 'AppBarButton', 'AppBarToggleButton']) {
    const type = b.control(name, C + 'Primitives.ButtonBase');
    b.props(type, { Command: 'System.Windows.Input.ICommand', CommandParameter: 'object', ClickMode: [C + 'ClickMode', 0],
      IsPressed: ['bool', false, true], IsPointerOver: ['bool', false, true], Flyout: 'object' });
    b.property(type, 'AttachedFlyout', 'object');
    b.event(type, 'Click');
    b.method(type, 'Invoke');
  }
  b.props(C + 'RepeatButton', { Delay: ['int', 500], Interval: ['int', 100] });
  for (const name of ['ToggleButton', 'CheckBox', 'RadioButton', 'ToggleSplitButton', 'AppBarToggleButton']) {
    b.props(C + name, { IsChecked: ['bool', false], IsThreeState: ['bool', false], IsIndeterminate: ['bool', false, true] });
    b.method(C + name, 'SetChecked', ['object']);
    b.method(C + name, 'GetChecked', [], 'object');
    b.events(C + name, ['Checked', 'Unchecked', 'Indeterminate']);
  }
  b.event(C + 'ToggleSplitButton', 'IsCheckedChanged');
  for (const name of ['AppBarButton', 'AppBarToggleButton']) b.props(C + name, { Icon: 'object',
    Label: ['string', ''], LabelPosition: ['int', 0], IsCompact: ['bool', false], DynamicOverflowOrder: ['int', 0],
    IsInOverflow: ['bool', false, true] });
  b.control('AppBarSeparator', C + 'Control');
  b.props(C + 'AppBarSeparator', { DynamicOverflowOrder: ['int', 0], IsInOverflow: ['bool', false, true] });
  b.control('AppBarElementContainer', C + 'ContentControl', { DynamicOverflowOrder: ['int', 0],
    IsInOverflow: ['bool', false, true], IsCompact: ['bool', false] });
  b.control('MenuFlyoutItemBase', C + 'Control');
  for (const name of ['MenuFlyoutItem', 'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem', 'MenuFlyoutSubItem',
    'MenuFlyoutSeparator', 'MenuBarItem']) {
    b.control(name, C + 'MenuFlyoutItemBase', { Text: ['string', ''], Icon: 'object', Command: 'System.Windows.Input.ICommand',
      CommandParameter: 'object', IsChecked: ['bool', false], GroupName: ['string', ''],
      KeyboardAcceleratorTextOverride: ['string', ''], Items: [C + 'ItemCollection', null, true] }, ['Click']);
  }
  b.control('MenuBar', C + 'Control', { Items: [C + 'ItemCollection', null, true] });
  b.property(C + 'MenuBarItem', 'Title', 'string', '');
  for (const name of ['ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem']) b.events(C + name, ['Checked', 'Unchecked']);
  b.enumeration(C + 'CommandBarDefaultLabelPosition', { Bottom: 0, Right: 1, Collapsed: 2 });
  b.enumeration(C + 'CommandBarOverflowButtonVisibility', { Auto: 0, Visible: 1, Collapsed: 2 });
  b.enumeration(C + 'AppBarClosedDisplayMode', { Compact: 0, Minimal: 1, Hidden: 2 });
  b.props(C + 'CommandBar', { PrimaryCommands: [C + 'ItemCollection', null, true], SecondaryCommands: [C + 'ItemCollection', null, true],
    Content: 'object', IsOpen: ['bool', false], IsDynamicOverflowEnabled: ['bool', true], ClosedDisplayMode: [C + 'AppBarClosedDisplayMode', 0],
    DefaultLabelPosition: [C + 'CommandBarDefaultLabelPosition', 0], OverflowButtonVisibility: [C + 'CommandBarOverflowButtonVisibility', 0] });
  b.events(C + 'CommandBar', ['Opening', 'Opened', 'Closing', 'Closed', 'DynamicOverflowItemsChanging']);
  b.enumeration(C + 'CommandBarDynamicOverflowAction', { AddingToOverflow: 0, RemovingFromOverflow: 1 });
  b.event(C + 'CommandBar', 'DynamicOverflowItemsChanging', { Action: C + 'CommandBarDynamicOverflowAction', Items: 'object[]' });
  b.event(X + 'UIElement', 'ContextRequested', { Handled: ['bool', false], Position: 'Windows.Foundation.Point' });
  b.event(X + 'UIElement', 'ContextCanceled');
  for (const name of ['CommandBarFlyout', 'TextCommandBarFlyout']) {
    b.control(name, C + 'Control', { PrimaryCommands: [C + 'ItemCollection', null, true],
      SecondaryCommands: [C + 'ItemCollection', null, true], IsOpen: ['bool', false], AlwaysExpanded: ['bool', false] });
    b.method(C + name, 'ShowAt', [X + 'FrameworkElement']); b.method(C + name, 'Hide');
    b.events(C + name, ['Opening', 'Opened', 'Closed']);
    b.event(C + name, 'Closing', { Cancel: ['bool', false], Result: ['int', 0], Reason: ['string', ''] }, { deferral: true });
  }
  b.control('SwipeItem', X + 'DependencyObject', { Text: ['string', ''], IconSource: 'object',
    Command: 'System.Windows.Input.ICommand', CommandParameter: 'object', BehaviorOnInvoked: ['int', 0] }, ['Invoked']);
  b.event(C + 'SwipeItem', 'Invoked', { SwipeControl: C + 'SwipeControl' });
  b.collection(C + 'SwipeItems', C + 'SwipeItem'); b.property(C + 'SwipeItems', 'Mode', 'int', 0);
  b.control('SwipeControl', C + 'ContentControl', { LeftItems: C + 'SwipeItems', RightItems: C + 'SwipeItems',
    TopItems: C + 'SwipeItems', BottomItems: C + 'SwipeItems', Threshold: ['double', 64], IsOpen: ['bool', false, true] });
  b.method(C + 'SwipeControl', 'Close');
  b.control('RefreshVisualizer', C + 'Control', { State: ['int', 0, true], Orientation: ['int', 0] });
  b.control('RefreshContainer', C + 'ContentControl', { Visualizer: C + 'RefreshVisualizer', PullDirection: ['int', 0],
    IsRefreshing: ['bool', false, true] });
  b.event(C + 'RefreshContainer', 'RefreshRequested', {}, { deferral: true });
  b.method(C + 'RefreshContainer', 'RequestRefreshAsync', [], b.task());
}
