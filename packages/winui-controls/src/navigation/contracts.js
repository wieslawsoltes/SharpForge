export function registerNavigationContracts(b) {
  const { X, C } = b, N = X + 'Navigation.';
  b.enumeration(N + 'NavigationMode', { New: 0, Back: 1, Forward: 2, Refresh: 3 });
  b.enumeration(N + 'NavigationCacheMode', { Disabled: 0, Required: 1, Enabled: 2 });
  for (const name of ['NavigationEventArgs', 'NavigationCancelEventArgs']) {
    b.type(N + name, X + 'RoutedEventArgs', 'eventArgs');
    b.props(N + name, { SourcePageType: 'object', Parameter: 'object', NavigationMode: N + 'NavigationMode',
      Content: 'object', Cancel: ['bool', false], NavigationTransitionInfo: 'object' });
  }
  b.method(C + 'Page', 'OnNavigatingFrom', [N + 'NavigationCancelEventArgs']);
  b.method(C + 'Page', 'OnNavigatedFrom', [N + 'NavigationEventArgs']);
  b.method(C + 'Page', 'OnNavigatedTo', [N + 'NavigationEventArgs']);
  b.type(N + 'PageStackEntry');
  b.props(N + 'PageStackEntry', { SourcePageType: 'object', Parameter: 'object', NavigationTransitionInfo: 'object' });
  b.control('Frame', C + 'ContentControl', { CanGoBack: ['bool', false, true], CanGoForward: ['bool', false, true],
    BackStackDepth: ['int', 0, true], BackStack: [C + 'ItemCollection', null, true], ForwardStack: [C + 'ItemCollection', null, true],
    CacheSize: ['int', 10], SourcePageType: 'object', CurrentSourcePageType: ['object', null, true], IsNavigationStackEnabled: ['bool', true] });
  for (const parameters of [['object'], ['object', 'object'], ['object', 'object', 'object']]) b.method(C + 'Frame', 'Navigate', parameters, 'bool');
  b.method(C + 'Frame', 'GoBack'); b.method(C + 'Frame', 'GoForward');
  b.event(C + 'Frame', 'Navigating', { SourcePageType: 'object', Parameter: 'object', NavigationMode: N + 'NavigationMode', Cancel: 'bool' });
  b.event(C + 'Frame', 'Navigated', { SourcePageType: 'object', Parameter: 'object', Content: 'object', NavigationMode: N + 'NavigationMode' });
  b.event(C + 'Frame', 'NavigationFailed', { SourcePageType: 'object', Exception: 'object', Handled: 'bool' });
  b.event(C + 'Frame', 'NavigationStopped', { SourcePageType: 'object', Parameter: 'object' });
  b.props(C + 'Page', { Frame: [C + 'Frame', null, true], NavigationCacheMode: [N + 'NavigationCacheMode', 0] });
  b.enumeration(C + 'NavigationViewDisplayMode', { Minimal: 0, Compact: 1, Expanded: 2 });
  b.enumeration(C + 'NavigationViewBackButtonVisible', { Collapsed: 0, Visible: 1, Auto: 2 });
  b.enumeration(C + 'SplitViewDisplayMode', { Overlay: 0, Inline: 1, CompactOverlay: 2, CompactInline: 3 });
  b.enumeration(C + 'SplitViewPanePlacement', { Left: 0, Right: 1 });
  b.enumeration(C + 'NavigationViewPaneDisplayMode', { Auto: 0, Left: 1, Top: 2, LeftCompact: 3, LeftMinimal: 4 });
  b.props(C + 'NavigationView', { MenuItemsSource: 'object', FooterMenuItems: [C + 'ItemCollection', null, true],
    FooterMenuItemsSource: 'object', DisplayMode: [C + 'NavigationViewDisplayMode', 0, true],
    SettingsItem: ['object', null, true], IsPaneToggleButtonVisible: ['bool', true], PaneDisplayMode: [C + 'NavigationViewPaneDisplayMode', 0], PaneTitle: ['string', ''],
    PaneHeader: 'object', PaneFooter: 'object', AutoSuggestBox: C + 'AutoSuggestBox', IsBackEnabled: ['bool', false],
    IsBackButtonVisible: ['int', 0], IsSettingsVisible: ['bool', true], OpenPaneLength: ['double', 320],
    CompactPaneLength: ['double', 48], ExpandedModeThresholdWidth: ['double', 1008], CompactModeThresholdWidth: ['double', 641] });
  b.events(C + 'NavigationView', ['BackRequested', 'ItemInvoked', 'PaneOpening', 'PaneOpened', 'PaneClosing', 'PaneClosed',
    'ItemExpanding', 'ItemCollapsed']);
  b.event(C + 'NavigationView', 'DisplayModeChanged', { DisplayMode: C + 'NavigationViewDisplayMode' });
  b.event(C + 'NavigationView', 'ItemInvoked', { InvokedItem: 'object', InvokedItemContainer: C + 'NavigationViewItem', IsSettingsInvoked: 'bool' });
  b.event(C + 'NavigationView', 'SelectionChanged', { SelectedItem: 'object', SelectedItemContainer: C + 'NavigationViewItem',
    PreviousItemContainer: C + 'NavigationViewItem', SelectedIndex: 'int', IsSettingsSelected: 'bool' });
  for (const name of ['ItemExpanding', 'ItemCollapsed']) b.event(C + 'NavigationView', name, { ExpandingItem: 'object',
    ExpandingItemContainer: C + 'NavigationViewItem' });
  b.props(C + 'NavigationViewItem', { MenuItems: [C + 'ItemCollection', null, true], MenuItemsSource: 'object', Icon: 'object',
    IsExpanded: ['bool', false], IsSelected: ['bool', false], SelectsOnInvoked: ['bool', true], InfoBadge: 'object' });
  b.control('NavigationViewItemHeader', C + 'ContentControl'); b.control('NavigationViewItemSeparator', C + 'Control');
  b.props(C + 'TabView', { SelectedItem: 'object', TabItemsSource: 'object', TabItemTemplate: 'object',
    IsAddTabButtonVisible: ['bool', true], CanDragTabs: ['bool', false], CanReorderTabs: ['bool', true], TabWidthMode: ['int', 0],
    TabStripHeader: 'object', TabStripFooter: 'object' });
  b.events(C + 'TabView', ['AddTabButtonClick', 'TabStripDragOver', 'TabStripDrop']);
  b.event(C + 'TabView', 'TabCloseRequested', { Item: 'object', Tab: C + 'TabViewItem', Index: 'int' });
  b.event(C + 'TabView', 'TabDragStarting', { Item: 'object', Tab: C + 'TabViewItem', Cancel: 'bool' });
  b.event(C + 'TabView', 'TabDragCompleted', { Item: 'object', Items: 'object[]', FromIndex: 'int', ToIndex: 'int', CollectionProperty: 'string' });
  b.event(C + 'TabView', 'TabDroppedOutside', { Item: 'object', Tab: C + 'TabViewItem' });
  b.props(C + 'TabViewItem', { IconSource: 'object', IsSelected: ['bool', false] });
  b.control('Pivot', C + 'Control', { Items: [C + 'ItemCollection', null, true], ItemsSource: 'object', SelectedIndex: ['int', 0],
    SelectedItem: 'object', Title: 'object', HeaderTemplate: 'object', IsLocked: ['bool', false] }, ['SelectionChanged', 'PivotItemLoading',
    'PivotItemLoaded', 'PivotItemUnloading', 'PivotItemUnloaded']);
  b.control('PivotItem', C + 'ContentControl', { Header: 'object' });
  b.control('SplitView', C + 'ContentControl', { Pane: X + 'UIElement', IsPaneOpen: ['bool', false], DisplayMode: ['int', 0],
    PanePlacement: ['int', 0], OpenPaneLength: ['double', 320], CompactPaneLength: ['double', 48],
    PaneBackground: X + 'Media.Brush' }, ['PaneOpening', 'PaneOpened', 'PaneClosing', 'PaneClosed']);
  for (const name of ['NavigationView', 'SplitView']) {
    b.event(C + name, 'PaneClosing', { Cancel: 'bool', IsPaneOpen: 'bool', Reason: 'string' });
    b.event(C + name, 'PaneOpening', { IsPaneOpen: 'bool', Reason: 'string' });
    b.event(C + name, 'PaneOpened', { IsPaneOpen: 'bool', Reason: 'string' });
    b.event(C + name, 'PaneClosed', { IsPaneOpen: 'bool', Reason: 'string' });
  }
  registerOverlayContracts(b);
}

function registerOverlayContracts(b) {
  const { X, C } = b;
  b.enumeration(C + 'Primitives.FlyoutPlacementMode', { Top: 0, Bottom: 1, Left: 2, Right: 3, Full: 4,
    TopEdgeAlignedLeft: 5, TopEdgeAlignedRight: 6, BottomEdgeAlignedLeft: 7, BottomEdgeAlignedRight: 8,
    LeftEdgeAlignedTop: 9, LeftEdgeAlignedBottom: 10, RightEdgeAlignedTop: 11, RightEdgeAlignedBottom: 12, Auto: 13 });
  b.type('Windows.Foundation.Deferral'); b.method('Windows.Foundation.Deferral', 'Complete');
  b.enumeration(C + 'TeachingTipCloseReason', { CloseButton: 0, LightDismiss: 1, Programmatic: 2 });
  b.enumeration(C + 'TeachingTipPlacementMode', { Auto: 0, Top: 1, Bottom: 2, Left: 3, Right: 4, TopRight: 5, TopLeft: 6,
    BottomRight: 7, BottomLeft: 8, LeftTop: 9, LeftBottom: 10, RightTop: 11, RightBottom: 12, Center: 13 });
  b.enumeration(C + 'TeachingTipTailVisibility', { Auto: 0, Visible: 1, Collapsed: 2 });
  b.control('Primitives.Popup', X + 'FrameworkElement', { Child: X + 'UIElement', IsOpen: ['bool', false],
    IsLightDismissEnabled: ['bool', false], HorizontalOffset: ['double', 0], VerticalOffset: ['double', 0],
    ShouldConstrainToRootBounds: ['bool', true] }, ['Opened', 'Closed']);
  b.control('Primitives.FlyoutBase', X + 'DependencyObject');
  for (const name of ['Flyout', 'MenuFlyout', 'ContentDialog', 'TeachingTip', 'ToolTip', 'DatePickerFlyout', 'TimePickerFlyout']) {
    const type = b.control(name, C + 'ContentControl', { IsOpen: ['bool', false], Placement: [C + 'Primitives.FlyoutPlacementMode', 0],
      Target: X + 'FrameworkElement', IsLightDismissEnabled: ['bool', true], XamlRoot: 'object' });
    b.events(type, ['Opening', 'Opened', 'Closed']);
    b.event(type, 'Closing', { Cancel: ['bool', false], Result: ['int', 0],
      Reason: name === 'TeachingTip' ? [C + 'TeachingTipCloseReason', 2] : ['string', ''] }, { deferral: true });
    b.method(type, 'ShowAt', [X + 'FrameworkElement']); b.method(type, 'Hide');
  }
  b.method(C + 'MenuFlyout', 'ShowAt', [X + 'FrameworkElement', 'Windows.Foundation.Point']);
  b.enumeration(C + 'ContentDialogResult', { None: 0, Primary: 1, Secondary: 2 });
  b.method(C + 'ContentDialog', 'ShowAsync', [], b.task(C + 'ContentDialogResult'));
  b.props(C + 'ContentDialog', { DefaultButton: ['int', 0], IsPrimaryButtonEnabled: ['bool', true],
    IsSecondaryButtonEnabled: ['bool', true], PrimaryButtonCommand: 'System.Windows.Input.ICommand',
    SecondaryButtonCommand: 'System.Windows.Input.ICommand', CloseButtonCommand: 'System.Windows.Input.ICommand' });
  for (const name of ['PrimaryButtonClick', 'SecondaryButtonClick', 'CloseButtonClick']) {
    b.event(C + 'ContentDialog', name, { Cancel: ['bool', false] }, { deferral: true });
  }
  b.props(C + 'TeachingTip', { Title: ['string', ''], Subtitle: ['string', ''], HeroContent: 'object',
    ActionButtonContent: 'object', CloseButtonContent: ['object', 'Close'], ActionButtonText: ['string', ''], CloseButtonText: ['string', 'Close'],
    ActionButtonCommand: 'System.Windows.Input.ICommand', ActionButtonCommandParameter: 'object',
    CloseButtonCommand: 'System.Windows.Input.ICommand', CloseButtonCommandParameter: 'object',
    IconSource: C + 'IconSource', TailVisibility: [C + 'TeachingTipTailVisibility', 0],
    PreferredPlacement: [C + 'TeachingTipPlacementMode', 0], IsTailVisible: ['bool', true] });
  b.events(C + 'TeachingTip', ['ActionButtonClick', 'CloseButtonClick']);
  b.event(C + 'TeachingTip', 'Closed', { Reason: [C + 'TeachingTipCloseReason', 2] });
  b.type(C + 'ToolTipService', 'object', 'static', []);
  for (const name of ['ToolTip', 'Placement', 'PlacementTarget']) {
    b.method(C + 'ToolTipService', 'Set' + name, [X + 'DependencyObject', name === 'Placement' ? 'int' : 'object'], 'void',
      { kind: 'attachedSet', isStatic: true, property: 'ToolTipService.' + name });
    b.method(C + 'ToolTipService', 'Get' + name, [X + 'DependencyObject'], name === 'Placement' ? 'int' : 'object',
      { kind: 'attachedGet', isStatic: true, property: 'ToolTipService.' + name });
  }
}
