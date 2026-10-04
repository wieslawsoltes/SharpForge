const controls = 'Microsoft.UI.Xaml.Controls.';

function presenter(name, binding) {
  return { type: 'ContentPresenter', name, bindings: binding ? { Content: binding,
    ContentTemplate: 'ContentTemplate', ContentTemplateSelector: 'ContentTemplateSelector' } : {} };
}

function recipe(family, types, content, nativeParts, container = 'ContentPresenter') {
  const behavior = presenter('PART_BehaviorRoot', content);
  const holder = { type: container, name: family === 'Text' ? 'ContentElement' : 'ContentPresenter', child: behavior };
  const visualTree = { type: 'Grid', name: 'LayoutRoot', children: [
    { type: 'Border', name: 'RootBorder', bindings: { Background: 'Background', BorderBrush: 'BorderBrush',
      BorderThickness: 'BorderThickness', CornerRadius: 'CornerRadius' }, child: holder },
    { type: 'Border', name: 'FocusVisual', properties: { Opacity: 0, IsHitTestVisible: false,
      BorderThickness: { Left: 2, Top: 2, Right: 2, Bottom: 2 } },
      resources: { BorderBrush: 'FocusStrokeColorOuterBrush' } },
    { type: 'Border', name: 'SelectionVisual', properties: { Opacity: 0, IsHitTestVisible: false,
      BorderThickness: { Left: 2, Top: 2, Right: 2, Bottom: 2 } },
      resources: { BorderBrush: 'AccentFillColorDefaultBrush' } }
  ] };
  return { version: 1, family, types, visualTree, behaviorPart: 'PART_BehaviorRoot', nativeParts,
    styleSetters: ['Button', 'SplitButton', 'Toggle'].includes(family)
      ? { Padding: { Left: 11, Top: 5, Right: 11, Bottom: 6 }, MinHeight: 32 } : {},
    contentBinding: content, itemsBinding: family === 'Items' ? { source: 'ItemsSource', collection: 'Items' } : null,
    visualStates: [
      { name: 'CommonStates', states: [
        { name: 'Normal', setters: [{ target: 'RootBorder', property: 'Opacity', value: 1 }] },
        { name: 'PointerOver', setters: [{ target: 'RootBorder', property: 'Opacity', value: 0.95 }] },
        { name: 'Pressed', setters: [{ target: 'RootBorder', property: 'Opacity', value: 0.85 }] },
        { name: 'Disabled', setters: [{ target: 'RootBorder', property: 'Opacity', value: 0.45 }] }
      ] },
      { name: 'FocusStates', states: [
        { name: 'Unfocused', setters: [{ target: 'FocusVisual', property: 'Opacity', value: 0 }] },
        { name: 'Focused', setters: [{ target: 'FocusVisual', property: 'Opacity', value: 1 }] },
        { name: 'PointerFocused', setters: [{ target: 'FocusVisual', property: 'Opacity', value: 0 }] }
      ] },
      { name: 'SelectionStates', states: [
        { name: 'Unselected', setters: [{ target: 'SelectionVisual', property: 'Opacity', value: 0 }] },
        { name: 'Selected', setters: [{ target: 'SelectionVisual', property: 'Opacity', value: 1 }] }
      ] }
    ] };
}

/** These are browser-profile templates, not claims about private native WinUI template structure. */
function freezeRecipe(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRecipe(child);
  return Object.freeze(value);
}

function expanderRecipe() {
  const value = recipe('Expander', ['Expander'], 'Content', ['expander-header', 'expander-content']);
  value.visualTree.children[0].child = { type: 'StackPanel', name: 'ExpanderLayoutRoot', children: [
    { type: 'ContentPresenter', name: 'HeaderPresenter', bindings: { Content: 'Header',
      ContentTemplate: 'HeaderTemplate', ContentTemplateSelector: 'HeaderTemplateSelector' } },
    presenter('PART_BehaviorRoot', 'Content')
  ] };
  return value;
}

function navigationRecipe(type) {
  const value = recipe('Navigation', [type], 'Content', ['navigation-pane', 'navigation-content', 'navigation-toggle']);
  value.visualTree.children[0].child = { type: 'Grid', name: 'NavigationLayoutRoot', children: [
    presenter('PanePresenter', type === 'SplitView' ? 'Pane' : null),
    presenter('NavigationContentPresenter', 'Content'),
    presenter('PART_BehaviorRoot', null)
  ] };
  return value;
}

function scrollViewRecipe() {
  const bindings = Object.fromEntries(['Content', 'ContentOrientation', 'HorizontalScrollMode', 'VerticalScrollMode', 'ZoomMode',
    'MinZoomFactor', 'MaxZoomFactor', 'HorizontalScrollBarVisibility', 'VerticalScrollBarVisibility',
    'HorizontalAnchorRatio', 'VerticalAnchorRatio'].map(name => [name, name]));
  return { version: 1, family: 'ScrollView', types: ['ScrollView'], behaviorPart: null, nativeParts: [],
    styleSetters: {}, visualStates: [], visualTree: { type: 'Primitives.ScrollPresenter', name: 'PART_ScrollPresenter', bindings } };
}

export const defaultControlTemplates = freezeRecipe([
  recipe('Button', ['Button', 'ToggleButton', 'RepeatButton', 'HyperlinkButton', 'DropDownButton', 'AppBarButton',
    'AppBarToggleButton'], 'Content', []),
  recipe('SplitButton', ['SplitButton', 'ToggleSplitButton'], 'Content', ['split-primary', 'split-secondary']),
  recipe('Toggle', ['CheckBox', 'RadioButton', 'ToggleSwitch'], 'Content', ['toggle-input', 'toggle-content']),
  recipe('Text', ['TextBox', 'PasswordBox', 'AutoSuggestBox'], 'Text', ['text-header', 'text-editor', 'text-description'], 'ScrollViewer'),
  recipe('RichText', ['RichEditBox'], 'Text', ['rich-editor']),
  recipe('Items', ['ListView', 'GridView', 'ItemsView', 'ListBox'], 'ItemsSource', ['items-header', 'items-viewport', 'items-footer']),
  recipe('ComboBox', ['ComboBox'], 'SelectedItem', ['combo-header', 'combo-editor', 'combo-toggle', 'combo-popup']),
  recipe('Tree', ['TreeView'], 'ItemsSource', ['tree-row']),
  recipe('Selector', ['FlipView', 'PipsPager', 'SelectorBar', 'RadioButtons', 'BreadcrumbBar', 'SemanticZoom'], null, []),
  navigationRecipe('NavigationView'),
  navigationRecipe('SplitView'),
  recipe('Tabs', ['TabView', 'Pivot'], 'SelectedItem', ['tab-headers', 'tab-content']),
  recipe('Content', ['Page', 'Frame', 'TabViewItem', 'PivotItem', 'NavigationViewItem', 'ListViewItem', 'ListBoxItem',
    'GridViewItem', 'ComboBoxItem', 'FlipViewItem', 'ItemContainer', 'SelectorBarItem', 'AppBarElementContainer'], 'Content', []),
  expanderRecipe(),
  scrollViewRecipe(),
  recipe('Overlay', ['ContentDialog', 'TeachingTip'], 'Content', ['overlay-title', 'overlay-subtitle', 'overlay-content', 'overlay-buttons']),
  recipe('Menu', ['MenuFlyout', 'MenuFlyoutItem', 'MenuFlyoutSubItem', 'ToggleMenuFlyoutItem', 'RadioMenuFlyoutItem', 'MenuBar',
    'MenuBarItem'], null, []),
  recipe('CommandBar', ['CommandBar', 'CommandBarFlyout', 'TextCommandBarFlyout'], 'Content', ['command-content', 'command-primary']),
  recipe('Number', ['NumberBox'], 'Header', ['number-input']),
  recipe('Range', ['Slider', 'ProgressBar', 'ProgressRing', 'RatingControl', 'ColorPicker'], null, []),
  recipe('Calendar', ['CalendarView', 'CalendarDatePicker', 'DatePicker', 'TimePicker'], 'Header', []),
  recipe('Status', ['InfoBar', 'InfoBadge', 'PersonPicture'], null, []),
  recipe('Gestures', ['SwipeControl', 'RefreshContainer', 'RefreshVisualizer'], 'Content', ['swipe-actions', 'swipe-content'])
]);

const byType = new Map(defaultControlTemplates.flatMap(value => value.types.map(type => [controls + type, value])));

/** Returns an immutable recipe description; a new managed visual tree is materialized per owner. */
export function defaultControlTemplate(type) {
  return byType.get(type.startsWith(controls) ? type : controls + type) ?? null;
}

/** Factories allocate real managed nodes, bindings, named parts, states, templates and styles. */
export function materializeDefaultControlStyle(type, factories) {
  const description = defaultControlTemplate(type);
  if (!description) return null;
  const parts = new Map();
  const build = node => {
    const properties = { ...node.properties, Name: node.name };
    const element = factories.create(controls + node.type, properties);
    parts.set(node.name, element);
    for (const [property, source] of Object.entries(node.bindings ?? {})) {
      if (factories.hasProperty?.(type, source) === false || factories.hasProperty?.(controls + node.type, property) === false) continue;
      factories.bind(element, property, source);
    }
    for (const [property, key] of Object.entries(node.resources ?? {})) factories.resource(element, property, key);
    if (node.child) factories.child(element, build(node.child));
    if (node.children) factories.children(element, node.children.map(build));
    return element;
  };
  const root = build(description.visualTree);
  const template = factories.template(type, root, { parts, family: description.family, itemsBinding: description.itemsBinding });
  factories.states(template, description.visualStates, parts);
  return factories.style(type, { ...description.styleSetters, Template: template });
}

/** State names match the catalog; services.visualStates applies them to the managed owner. */
export function controlVisualStates(properties) {
  const common = properties.IsEnabled === false ? 'Disabled' : properties.IsPressed ? 'Pressed'
    : properties.IsPointerOver ? 'PointerOver' : 'Normal';
  const focus = properties.FocusState === 2 || properties.FocusState === 3 ? 'Focused' : properties.FocusState === 1
    ? 'PointerFocused' : 'Unfocused';
  return [common, focus, properties.IsSelected ? 'Selected' : 'Unselected'];
}
