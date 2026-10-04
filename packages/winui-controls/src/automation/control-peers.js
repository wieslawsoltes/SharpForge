import { AutomationControlType as Type, PatternInterface as Pattern } from './enums.js';
import { FrameworkElementAutomationPeer } from './automation-peer.js';

class BuiltInAutomationPeer extends FrameworkElementAutomationPeer {
  constructor(owner, tree) { super(owner, tree, tree.definitionFor(owner)); }
}

export class ButtonAutomationPeer extends BuiltInAutomationPeer {}
export class ToggleButtonAutomationPeer extends BuiltInAutomationPeer {}
export class CheckBoxAutomationPeer extends BuiltInAutomationPeer {}
export class RadioButtonAutomationPeer extends BuiltInAutomationPeer {}
export class ToggleSwitchAutomationPeer extends BuiltInAutomationPeer {}
export class TextBoxAutomationPeer extends BuiltInAutomationPeer {}
export class PasswordBoxAutomationPeer extends BuiltInAutomationPeer {}
export class RichEditBoxAutomationPeer extends BuiltInAutomationPeer {}
export class TextBlockAutomationPeer extends BuiltInAutomationPeer {}
export class SliderAutomationPeer extends BuiltInAutomationPeer {}
export class ProgressBarAutomationPeer extends BuiltInAutomationPeer {}
export class ComboBoxAutomationPeer extends BuiltInAutomationPeer {}
export class ListViewAutomationPeer extends BuiltInAutomationPeer {}
export class ListViewItemAutomationPeer extends BuiltInAutomationPeer {}
export class TabViewAutomationPeer extends BuiltInAutomationPeer {}
export class TabViewItemAutomationPeer extends BuiltInAutomationPeer {}
export class ExpanderAutomationPeer extends BuiltInAutomationPeer {}
export class TreeViewAutomationPeer extends BuiltInAutomationPeer {}
export class TreeViewItemAutomationPeer extends BuiltInAutomationPeer {}
export class ScrollViewerAutomationPeer extends BuiltInAutomationPeer {}
export class ImageAutomationPeer extends BuiltInAutomationPeer {}
export class ContentDialogAutomationPeer extends BuiltInAutomationPeer {}
export class FrameworkControlAutomationPeer extends BuiltInAutomationPeer {}

const definitions = new Map();
function define(names, controlType, patterns = [], options = {}) {
  const definition = Object.freeze({ controlType, patterns: Object.freeze(patterns), focusable: patterns.some(pattern =>
    [Pattern.Invoke, Pattern.Toggle, Pattern.Value, Pattern.RangeValue, Pattern.SelectionItem, Pattern.ExpandCollapse].includes(pattern)), ...options });
  for (const name of names.split(' ')) definitions.set(name, definition);
}

define('Button RepeatButton AppBarButton DropDownButton', Type.Button, [Pattern.Invoke], { Peer: ButtonAutomationPeer, textChildren: true });
define('HyperlinkButton Hyperlink', Type.Hyperlink, [Pattern.Invoke], { Peer: ButtonAutomationPeer, textChildren: true });
define('ToggleButton AppBarToggleButton', Type.Button, [Pattern.Toggle], { Peer: ToggleButtonAutomationPeer, textChildren: true });
define('CheckBox', Type.CheckBox, [Pattern.Toggle], { Peer: CheckBoxAutomationPeer, textChildren: true });
define('RadioButton', Type.RadioButton, [Pattern.SelectionItem], { Peer: RadioButtonAutomationPeer, textChildren: true });
define('ToggleSwitch', Type.CheckBox, [Pattern.Toggle], { Peer: ToggleSwitchAutomationPeer, role: 'switch' });
define('SplitButton', Type.SplitButton, [Pattern.Invoke, Pattern.ExpandCollapse], { Peer: ButtonAutomationPeer, textChildren: true });
define('ToggleSplitButton', Type.SplitButton, [Pattern.Toggle, Pattern.ExpandCollapse], { Peer: ToggleButtonAutomationPeer });
define('TextBox', Type.Edit, [Pattern.Value, Pattern.Text], { Peer: TextBoxAutomationPeer, nameProperties: ['Header'] });
define('AutoSuggestBox', Type.ComboBox, [Pattern.Value, Pattern.Text, Pattern.ExpandCollapse],
  { Peer: TextBoxAutomationPeer, nameProperties: ['Header'], popup: 'listbox' });
define('PasswordBox', Type.Edit, [], { Peer: PasswordBoxAutomationPeer, password: true, focusable: true, nameProperties: ['Header'] });
define('RichEditBox', Type.Document, [Pattern.Text, Pattern.Value], { Peer: RichEditBoxAutomationPeer, role: 'textbox', nameProperties: ['Header'] });
define('TextBlock RichTextBlock RichTextBlockOverflow', Type.Text, [Pattern.Text],
  { Peer: TextBlockAutomationPeer, nameProperties: ['Text', 'PlainText'], textChildren: true, textSelectable: false });
define('Slider RatingControl', Type.Slider, [Pattern.RangeValue], { Peer: SliderAutomationPeer, nameProperties: ['Header'] });
define('NumberBox', Type.Spinner, [Pattern.RangeValue], { Peer: SliderAutomationPeer, role: 'spinbutton', nameProperties: ['Header'] });
define('ColorPicker', Type.Group, [], { focusable: true, nameProperties: ['Header'] });
define('ProgressBar ProgressRing', Type.ProgressBar, [Pattern.RangeValue],
  { Peer: ProgressBarAutomationPeer, readOnlyRange: true, focusable: false });
define('ComboBox', Type.ComboBox, [Pattern.Selection, Pattern.ExpandCollapse, Pattern.Value], { Peer: ComboBoxAutomationPeer, popup: 'listbox', editableValue: true });
define('ListView GridView ListBox ItemsView SelectorBar', Type.List, [Pattern.Selection, Pattern.Scroll],
  { Peer: ListViewAutomationPeer, role: 'listbox', focusable: true });
define('RadioButtons', Type.Group, [Pattern.Selection], { Peer: ListViewAutomationPeer, role: 'radiogroup', focusable: true });
define('ListViewItem GridViewItem ListBoxItem ComboBoxItem SelectorItem SelectorBarItem ItemContainer', Type.ListItem,
  [Pattern.SelectionItem, Pattern.ScrollItem], { Peer: ListViewItemAutomationPeer, role: 'option', textChildren: true });
define('TabView Pivot', Type.Tab, [Pattern.Selection], { Peer: TabViewAutomationPeer, focusable: true, selectionRequired: true });
define('TabViewItem PivotItem', Type.TabItem, [Pattern.SelectionItem], { Peer: TabViewItemAutomationPeer, textChildren: true });
define('Expander', Type.Group, [Pattern.ExpandCollapse], { Peer: ExpanderAutomationPeer, role: 'button', nameProperties: ['Header'] });
define('TreeView NavigationView', Type.Tree, [Pattern.Selection, Pattern.Scroll], { Peer: TreeViewAutomationPeer, focusable: true });
define('TreeViewItem TreeViewNode NavigationViewItem', Type.TreeItem, [Pattern.SelectionItem, Pattern.ExpandCollapse, Pattern.ScrollItem],
  { Peer: TreeViewItemAutomationPeer, textChildren: true });
define('ScrollViewer ScrollView ScrollPresenter', Type.Pane, [Pattern.Scroll], { Peer: ScrollViewerAutomationPeer, layoutScroll: true });
define('ScrollBar AnnotatedScrollBar', Type.ScrollBar, [Pattern.RangeValue], { Peer: SliderAutomationPeer });
define('Image ImageIcon FontIcon SymbolIcon PathIcon BitmapIcon AnimatedIcon PersonPicture', Type.Image, [], { Peer: ImageAutomationPeer });
define('TeachingTip DatePickerFlyout TimePickerFlyout', Type.Window, [], { role: 'dialog', nameProperties: ['Title', 'Content'] });
define('ContentDialog', Type.Window, [], { Peer: ContentDialogAutomationPeer, role: 'dialog', nameProperties: ['Title'], modal: true });
define('Flyout MenuFlyout MenuBarItem', Type.Menu, [Pattern.ExpandCollapse], { popup: 'menu' });
define('MenuFlyoutItem', Type.MenuItem, [Pattern.Invoke], { nameProperties: ['Text'] });
define('ToggleMenuFlyoutItem RadioMenuFlyoutItem', Type.MenuItem, [Pattern.Toggle], { role: 'menuitemcheckbox', nameProperties: ['Text'] });
define('MenuFlyoutSubItem', Type.MenuItem, [Pattern.ExpandCollapse], { nameProperties: ['Text'], popup: 'menu' });
define('MenuBar', Type.MenuBar);
define('MenuFlyoutSeparator AppBarSeparator NavigationViewItemSeparator', Type.Separator);
define('CommandBar AppBar CommandBarFlyout TextCommandBarFlyout MediaTransportControls', Type.ToolBar);
define('ToolTip', Type.ToolTip, [], { textChildren: true });
define('InfoBar InfoBadge', Type.StatusBar, [], { nameProperties: ['Title', 'Message', 'Value'] });
define('DatePicker CalendarDatePicker TimePicker', Type.ComboBox, [Pattern.ExpandCollapse, Pattern.Value], { focusable: true });
define('CalendarView', Type.Calendar, [Pattern.Selection], { focusable: true, role: 'grid' });
define('CalendarViewDayItem', Type.DataItem, [Pattern.SelectionItem], { role: 'gridcell', nameProperties: ['Date'] });
define('BreadcrumbBar PipsPager PagerControl', Type.List, [Pattern.Selection], { focusable: true });
define('BreadcrumbBarItem', Type.ListItem, [Pattern.Invoke], { textChildren: true, role: 'link' });
define('FlipView', Type.FlipView, [Pattern.Selection, Pattern.Scroll], { role: 'listbox', focusable: true });
define('SemanticZoom', Type.SemanticZoom, [Pattern.ExpandCollapse], { role: 'group' });
define('MediaPlayerElement MediaElement WebView2', Type.Pane, [], { focusable: true });
define('Window', Type.Window, [], { nameProperties: ['Title'] });
define('Grid StackPanel Canvas RelativePanel WrapGrid VariableSizedWrapGrid ItemsWrapGrid ItemsStackPanel VirtualizingStackPanel '
  + 'ItemsRepeater Border Viewbox ContentPresenter ContentControl UserControl Control Panel FrameworkElement '
  + 'ScrollContentPresenter TwoPaneView ParallaxView SplitView Frame Page DrawingSurface', Type.Pane, [], { publicFactory: false });
define('NavigationViewItemHeader', Type.Header, [], { textChildren: true });

export function builtInPeerDefinition(type, resolveType = () => null) {
  const visited = new Set();
  while (type && !visited.has(type)) {
    visited.add(type);
    const definition = definitions.get(type.slice(type.lastIndexOf('.') + 1));
    if (definition) return definition;
    type = resolveType(type)?.base;
  }
  return Object.freeze({ controlType: Type.Custom, patterns: Object.freeze([]), Peer: FrameworkControlAutomationPeer });
}

/** Distinct retained peer identities for each registered control; native public factories remain separately declared. */
export function controlPeerClass(type, definition = {}, cache = new Map()) {
  const name = type.slice(type.lastIndexOf('.') + 1) + 'AutomationPeer';
  const Base = definition.Peer ?? FrameworkControlAutomationPeer;
  const key = type + ':' + Base.name;
  if (!cache.has(key)) {
    if (cache.size >= 20000) throw new RangeError('SFAX013: Automation peer type budget exceeded');
    const Peer = Base.name === name ? Base : class extends Base {};
    if (Peer !== Base) Object.defineProperty(Peer, 'name', { value: name });
    cache.set(key, Peer);
  }
  return cache.get(key);
}

export function createBuiltInAutomationPeer(owner, tree) {
  const Peer = controlPeerClass(owner.frameworkType ?? owner.type, tree.definitionFor(owner), tree.peerClasses ??= new Map());
  return new Peer(owner, tree);
}

/** Adds a peer factory to every renderer descriptor, including the explicit custom-control fallback. */
export function registerAutomationAdapters(registry) {
  const groups = new Map();
  for (const [name, descriptor] of registry.entries) {
    if (descriptor.createAutomationPeer) continue;
    if (!groups.has(descriptor)) groups.set(descriptor, []);
    groups.get(descriptor).push(name);
  }
  for (const [descriptor, names] of groups) registry.register(names,
    { ...descriptor, createAutomationPeer: (context, node, tree) => createBuiltInAutomationPeer(node, tree) }, { override: true });
  return registry;
}
