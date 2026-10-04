const controls = 'Microsoft.UI.Xaml.Controls.';
const xaml = 'Microsoft.UI.Xaml.';
const commonItems = ['Alpha', 'βeta', '東京'];

/** Every visual family has a deterministic scene. Platform cases explicitly expect an unavailable capability. */
export const familyCases = [
  ...['Button', 'RepeatButton', 'DropDownButton', 'SplitButton', 'ToggleButton', 'ToggleSplitButton', 'AppBarButton',
    'AppBarToggleButton', 'CheckBox', 'RadioButton', 'HyperlinkButton'].map(type => ({ type, properties: { Content: type, Label: type } })),
  { type: 'ToggleSwitch', properties: { Header: 'Notifications', IsOn: false } },
  { type: 'TextBox', properties: { Text: 'Hello שלום', Header: 'Message', SelectionStart: 0, SelectionLength: 5 } },
  { type: 'PasswordBox', properties: { Header: 'Password' }, privateValue: 'private fixture' },
  { type: 'AutoSuggestBox', properties: { Text: 'Al', Header: 'Search', ItemsSource: commonItems } },
  { type: 'RichEditBox', properties: { Text: 'Rich document', Header: 'Document' } },
  { type: 'TextBlock', properties: { Text: 'Latin العربية 日本語', TextWrapping: 1 } },
  { type: 'RichTextBlock', properties: { Text: 'Flowing document', TextWrapping: 1 } },
  { type: 'RichTextBlockOverflow', properties: { Text: 'Overflow target', TextWrapping: 1 } },
  ...['ListView', 'GridView', 'ItemsView', 'ListBox', 'ComboBox', 'FlipView', 'SelectorBar', 'RadioButtons',
    'BreadcrumbBar'].map(type => ({ type, properties: { ItemsSource: commonItems, SelectedIndex: 0, Header: type } })),
  { type: 'TreeView', collections: { RootNodes: [{ Content: 'Root', IsExpanded: true, Children: [{ Content: 'Leaf' }] }] } },
  { type: 'PipsPager', properties: { NumberOfPages: 7, SelectedPageIndex: 2 } },
  { type: 'SemanticZoom', properties: { IsZoomedInViewActive: true } },
  ...['TabView', 'Pivot'].map(type => ({ type, collections: { [type === 'TabView' ? 'TabItems' : 'Items']: commonItems } })),
  { type: 'NavigationView', properties: { Header: 'Navigation', Content: 'Page', IsPaneOpen: true }, collections: { MenuItems: commonItems } },
  { type: 'SplitView', properties: { Content: 'Content', Pane: 'Pane', IsPaneOpen: true } },
  { type: 'Frame', properties: { Content: 'Current page' } },
  ...['ContentDialog', 'TeachingTip', 'Flyout', 'ToolTip'].map(type => ({ type, properties: { Title: type, Content: 'Overlay', IsOpen: false } })),
  { type: 'Primitives.Popup', properties: { IsOpen: false, Child: 'Popup' } },
  { type: 'NumberBox', properties: { Header: 'Amount', Minimum: 0, Maximum: 100, Value: 25, SpinButtonPlacementMode: 2 } },
  { type: 'Slider', properties: { Header: 'Volume', Minimum: 0, Maximum: 100, Value: 30, Orientation: 1 } },
  ...['ProgressBar', 'ProgressRing'].map(type => ({ type, properties: { Minimum: 0, Maximum: 100, Value: 60, IsIndeterminate: false } })),
  ...['DatePicker', 'CalendarDatePicker', 'DatePickerFlyout', 'CalendarView'].map(type => ({ type,
    properties: { Date: '2024-02-29', DateValue: { UnixTimeMilliseconds: 1709164800000 }, Header: 'Date' } })),
  ...['TimePicker', 'TimePickerFlyout'].map(type => ({ type, properties: { Time: '14:30', ClockIdentifier: '12HourClock' } })),
  { type: 'InfoBar', properties: { Title: 'Information', Message: 'Saved', IsOpen: true } },
  { type: 'InfoBadge', properties: { Value: 3 } },
  { type: 'RatingControl', properties: { Value: 3, MaxRating: 5, Caption: 'Rating' } },
  { type: 'ColorPicker', properties: { Color: { A: 255, R: 80, G: 120, B: 200 }, IsAlphaEnabled: true } },
  ...['MenuFlyout', 'MenuBar', 'CommandBar', 'CommandBarFlyout', 'TextCommandBarFlyout'].map(type => ({ type })),
  ...['MenuFlyoutItem', 'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem', 'MenuFlyoutSubItem', 'MenuBarItem']
    .map(type => ({ type, properties: { Text: type } })),
  { type: 'SwipeControl', properties: { Content: 'Swipe actions' } },
  { type: 'RefreshContainer', properties: { Content: 'Pull to refresh' } },
  { type: 'FontIcon', properties: { Glyph: '★', FontFamily: 'sans-serif' } },
  { type: 'SymbolIcon', properties: { Symbol: 0xe109 } },
  { type: 'PathIcon', properties: { Data: 'M2 10L8 16L18 3' } },
  { type: 'Image', properties: { Source: '', AlternativeText: 'Image fixture' } },
  { type: 'ImageIcon', properties: { Source: '' } },
  { type: 'BitmapIcon', properties: { Source: '' } },
  { type: 'IconSourceElement', properties: { IconSource: { Glyph: '★', FontFamily: 'sans-serif' } } },
  { type: 'PersonPicture', properties: { DisplayName: 'Ada Lovelace', BadgeNumber: 2 } },
  { type: 'WebView2', properties: { Html: '<p>Sandboxed document</p>' } },
  { type: 'MediaPlayerElement', properties: { Source: '', AutoPlay: false } },
  { type: 'InkCanvas', properties: { Width: 280, Height: 120 } },
  ...['MapControl', 'CaptureElement', 'AnimatedVisualPlayer', 'AnimatedIcon'].map(type => ({ type, unsupported: true }))
];

export function familyScene(value, { prefix = 'family', width = 360, height = 220 } = {}) {
  const testCase = typeof value === 'string' ? familyCases.find(item => item.type === value) : value;
  if (!testCase) throw new Error('Unknown family scene');
  const id = prefix + ':control';
  return { version: 1, windows: [prefix + ':window'], nodes: [
    { id: prefix + ':window', type: xaml + 'Window', properties: { Content: { $ref: id } }, collections: {}, events: [] },
    { id, type: controls + testCase.type, properties: { Name: testCase.type, Width: width, Height: height,
      IsEnabled: true, ...testCase.properties }, collections: { ...testCase.collections }, events: [] }
  ] };
}
