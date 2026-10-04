import { addType, addProperty, addMethod, addEvent } from './contract-registration.js';
import { registerInputContracts } from './layout-input.js';
import { registerEnvironmentContracts } from './environment.js';
import { registerScrollingContracts } from './scrolling.js';
import { registerAnnotatedScrollContracts } from './annotated-scrollbar.js';
export { registerInputStateContracts } from './input-state.js';

/** A16 contribution. Existing released signatures are preserved; newly declared members use the caller's reservation. */
export function registerLayoutContracts(registry) {
  registerGeometryValues(registry);
  registerElementLayout(registry);
  registerPanels(registry);
  registerScrolling(registry);
  registerScrollingContracts(registry);
  registerAnnotatedScrollContracts(registry);
  registerVirtualization(registry);
  registerInputContracts(registry);
  registerEnvironmentContracts(registry);
}

function enumeration(registry, name, values) { if (!registry.types.has(name)) registry.en(name, values); }

function registerGeometryValues(registry) {
  enumeration(registry, registry.CONTROLS + 'Orientation', { Vertical: 0, Horizontal: 1 });
  for (const [name, slots] of [['Size', ['Width', 'Height']], ['Point', ['X', 'Y']], ['Rect', ['X', 'Y', 'Width', 'Height']]]) {
    const type = 'Windows.Foundation.' + name;
    addType(registry, type, { kind: 'value', slots, base: 'System.ValueType' }, [[], slots.map(() => 'double')]);
    for (const slot of slots) addProperty(registry, type, slot, 'double', 0);
  }
}

function registerElementLayout(registry) {
  const { XAML, CONTROLS } = registry;
  for (const [name, parameters, result] of [
    ['Measure', ['Windows.Foundation.Size'], 'void'], ['Arrange', ['Windows.Foundation.Rect'], 'void'],
    ['InvalidateMeasure', [], 'void'], ['InvalidateArrange', [], 'void'], ['UpdateLayout', [], 'void']
  ]) addMethod(registry, XAML + 'UIElement', name, parameters, result);
  addProperty(registry, XAML + 'UIElement', 'DesiredSize', 'Windows.Foundation.Size', null, true);
  addProperty(registry, XAML + 'UIElement', 'RenderSize', 'Windows.Foundation.Size', null, true);
  addProperty(registry, XAML + 'UIElement', 'UseLayoutRounding', 'bool', true);
  addProperty(registry, XAML + 'UIElement', 'RenderTransformOrigin', 'Windows.Foundation.Point');
  for (const [name, type, value] of [['HorizontalContentAlignment', XAML + 'HorizontalAlignment', 1],
    ['VerticalContentAlignment', XAML + 'VerticalAlignment', 1]]) addProperty(registry, CONTROLS + 'Control', name, type, value);
  addMethod(registry, XAML + 'FrameworkElement', 'MeasureOverride', ['Windows.Foundation.Size'], 'Windows.Foundation.Size',
    { isVirtual: true, accessibility: 'protected' });
  addMethod(registry, XAML + 'FrameworkElement', 'ArrangeOverride', ['Windows.Foundation.Size'], 'Windows.Foundation.Size',
    { isVirtual: true, accessibility: 'protected' });
  enumeration(registry, XAML + 'FlowDirection', { LeftToRight: 0, RightToLeft: 1 });
  addProperty(registry, XAML + 'FrameworkElement', 'FlowDirection', XAML + 'FlowDirection', 0);
  for (const [axis, dimension] of [['Row', 'Height'], ['Column', 'Width']]) {
    const type = CONTROLS + axis + 'Definition';
    addProperty(registry, type, 'Min' + dimension, 'double', 0);
    addProperty(registry, type, 'Max' + dimension, 'double', Infinity);
    addProperty(registry, type, 'Actual' + dimension, 'double', 0, true);
  }
}

function registerPanels(registry) {
  const { XAML, CONTROLS } = registry;
  addType(registry, CONTROLS + 'RelativePanel', { base: CONTROLS + 'Panel', kind: 'control' });
  for (const name of ['AlignLeftWithPanel', 'AlignTopWithPanel', 'AlignRightWithPanel', 'AlignBottomWithPanel',
    'AlignHorizontalCenterWithPanel', 'AlignVerticalCenterWithPanel', 'LeftOf', 'RightOf', 'Above', 'Below',
    'AlignLeftWith', 'AlignTopWith', 'AlignRightWith', 'AlignBottomWith', 'AlignHorizontalCenterWith', 'AlignVerticalCenterWith']) {
    const type = name.endsWith('Panel') ? 'bool' : 'object';
    addMethod(registry, CONTROLS + 'RelativePanel', 'Set' + name, [XAML + 'UIElement', type], 'void',
      { isStatic: true, kind: 'attachedSet', property: 'RelativePanel.' + name });
    addMethod(registry, CONTROLS + 'RelativePanel', 'Get' + name, [XAML + 'UIElement'], type,
      { isStatic: true, kind: 'attachedGet', property: 'RelativePanel.' + name });
  }
  enumeration(registry, CONTROLS + 'StretchDirection', { Both: 0, UpOnly: 1, DownOnly: 2 });
  addProperty(registry, CONTROLS + 'Viewbox', 'StretchDirection', CONTROLS + 'StretchDirection', 0);
  enumeration(registry, CONTROLS + 'ExpandDirection', { Down: 0, Up: 1, Left: 2, Right: 3 });
  addProperty(registry, CONTROLS + 'Expander', 'ExpandDirection', CONTROLS + 'ExpandDirection', 0);
  for (const name of ['HeaderTemplate', 'ContentTemplate']) addProperty(registry, CONTROLS + 'Expander', name, 'object');
  for (const control of ['WrapGrid', 'VariableSizedWrapGrid']) {
    addProperty(registry, CONTROLS + control, 'HorizontalChildrenAlignment', XAML + 'HorizontalAlignment', 0);
    addProperty(registry, CONTROLS + control, 'VerticalChildrenAlignment', XAML + 'VerticalAlignment', 0);
  }
  addType(registry, CONTROLS + 'TwoPaneView', { base: CONTROLS + 'Control', kind: 'control' });
  for (const name of ['Pane1', 'Pane2']) addProperty(registry, CONTROLS + 'TwoPaneView', name, XAML + 'UIElement');
  for (const name of ['Pane1Length', 'Pane2Length']) addProperty(registry, CONTROLS + 'TwoPaneView', name, XAML + 'GridLength');
  for (const name of ['MinWideModeWidth', 'MinTallModeHeight']) addProperty(registry, CONTROLS + 'TwoPaneView', name, 'double', 641);
  for (const [name, values] of [['TwoPaneViewMode', { SinglePane: 0, Wide: 1, Tall: 2 }],
    ['TwoPaneViewPriority', { Pane1: 0, Pane2: 1 }], ['TwoPaneViewWideModeConfiguration', { LeftRight: 0, RightLeft: 1, SinglePane: 2 }],
    ['TwoPaneViewTallModeConfiguration', { TopBottom: 0, BottomTop: 1, SinglePane: 2 }]]) enumeration(registry, CONTROLS + name, values);
  for (const [name, type] of [['Mode', 'TwoPaneViewMode'], ['PanePriority', 'TwoPaneViewPriority'],
    ['WideModeConfiguration', 'TwoPaneViewWideModeConfiguration'], ['TallModeConfiguration', 'TwoPaneViewTallModeConfiguration']]) {
    addProperty(registry, CONTROLS + 'TwoPaneView', name, CONTROLS + type, 0, name === 'Mode');
  }
  addEvent(registry, CONTROLS + 'TwoPaneView', 'ModeChanged');
  addType(registry, CONTROLS + 'ParallaxView', { base: XAML + 'FrameworkElement', kind: 'control' });
  for (const name of ['Child', 'Source']) addProperty(registry, CONTROLS + 'ParallaxView', name, XAML + 'UIElement');
  for (const name of ['HorizontalShift', 'VerticalShift']) addProperty(registry, CONTROLS + 'ParallaxView', name, 'double', 0);
  addType(registry, CONTROLS + 'AnnotatedScrollBar', { base: CONTROLS + 'Control', kind: 'control' });
  for (const name of ['Minimum', 'Maximum', 'Value', 'ViewportSize']) addProperty(registry, CONTROLS + 'AnnotatedScrollBar', name, 'double', 0);
  addEvent(registry, CONTROLS + 'AnnotatedScrollBar', 'Scrolling');
}

function registerScrolling(registry) {
  const { CONTROLS } = registry;
  enumeration(registry, CONTROLS + 'ScrollMode', { Disabled: 0, Enabled: 1, Auto: 2 });
  enumeration(registry, CONTROLS + 'ZoomMode', { Disabled: 0, Enabled: 1 });
  for (const control of ['ScrollViewer', 'ScrollView', 'ScrollPresenter']) {
    const type = CONTROLS + control;
    addType(registry, type, { base: CONTROLS + 'ContentControl', kind: 'control',
      ...(control === 'ScrollPresenter' ? {xamlNamespace: 'using:Microsoft.UI.Xaml.Controls'} : {}) });
    for (const name of ['ExtentWidth', 'ExtentHeight', 'ViewportWidth', 'ViewportHeight', 'HorizontalOffset', 'VerticalOffset',
      'ScrollableWidth', 'ScrollableHeight']) addProperty(registry, type, name, 'double', 0, true);
    addProperty(registry, type, 'ZoomFactor', 'double', 1, true);
    addProperty(registry, type, 'MinZoomFactor', 'double', 0.1);
    addProperty(registry, type, 'MaxZoomFactor', 'double', 10);
    addProperty(registry, type, 'ZoomMode', CONTROLS + 'ZoomMode', 0);
    for (const axis of ['Horizontal', 'Vertical']) addProperty(registry, type, axis + 'ScrollMode', CONTROLS + 'ScrollMode', 1);
    addEvent(registry, type, 'ViewChanging');
    addEvent(registry, type, 'ViewChanged');
    if (control === 'ScrollViewer') {
      addMethod(registry, type, 'ChangeView', ['double?', 'double?', 'float?'], 'bool');
      addMethod(registry, type, 'ChangeView', ['double?', 'double?', 'float?', 'bool'], 'bool');
    } else {
      for (const name of ['ScrollTo', 'ScrollBy']) addMethod(registry, type, name, ['double', 'double'], 'int');
      addMethod(registry, type, 'ZoomTo', ['float', 'Windows.Foundation.Point'], 'int');
      addEvent(registry, type, 'ScrollCompleted');
      addEvent(registry, type, 'ZoomCompleted');
    }
  }
  addType(registry, CONTROLS + 'Primitives.ScrollBar', { base: CONTROLS + 'Control', kind: 'control' });
  addType(registry, CONTROLS + 'ScrollContentPresenter', { base: CONTROLS + 'ContentPresenter', kind: 'control' });
}

function registerVirtualization(registry) {
  const { XAML, CONTROLS } = registry;
  addType(registry, CONTROLS + 'Layout', { base: XAML + 'DependencyObject', kind: 'abstract' }, []);
  for (const name of ['ItemsStackPanel', 'VirtualizingStackPanel']) {
    addType(registry, CONTROLS + name, { base: CONTROLS + 'Panel', kind: 'control' });
    addProperty(registry, CONTROLS + name, 'Orientation', CONTROLS + 'Orientation', 0);
  }
  for (const name of ['VirtualizingLayout', 'StackLayout', 'UniformGridLayout', 'LinedFlowLayout']) {
    addType(registry, CONTROLS + name, { base: name === 'VirtualizingLayout' ? CONTROLS + 'Layout'
      : CONTROLS + 'VirtualizingLayout', kind: name === 'VirtualizingLayout' ? 'abstract' : 'object' }, name === 'VirtualizingLayout' ? [] : [[]]);
  }
  addProperty(registry, CONTROLS + 'StackLayout', 'Orientation', CONTROLS + 'Orientation', 0);
  addProperty(registry, CONTROLS + 'StackLayout', 'Spacing', 'double', 0);
  for (const name of ['MinItemWidth', 'MinItemHeight', 'MinRowSpacing', 'MinColumnSpacing']) {
    addProperty(registry, CONTROLS + 'UniformGridLayout', name, 'double', name.includes('Spacing') ? 0 : 32);
  }
  addProperty(registry, CONTROLS + 'LinedFlowLayout', 'LineHeight', 'double', 160);
  addType(registry, CONTROLS + 'ItemsRepeater', { base: XAML + 'FrameworkElement', kind: 'control' });
  for (const name of ['ItemsSource', 'ItemTemplate']) addProperty(registry, CONTROLS + 'ItemsRepeater', name, 'object');
  addProperty(registry, CONTROLS + 'ItemsRepeater', 'Layout', CONTROLS + 'VirtualizingLayout');
  for (const name of ['ElementPrepared', 'ElementClearing', 'ElementIndexChanged']) addEvent(registry, CONTROLS + 'ItemsRepeater', name);
  addMethod(registry, CONTROLS + 'ItemsRepeater', 'TryGetElement', ['int'], XAML + 'UIElement');
  addMethod(registry, CONTROLS + 'ItemsRepeater', 'GetElementIndex', [XAML + 'UIElement'], 'int');
}
