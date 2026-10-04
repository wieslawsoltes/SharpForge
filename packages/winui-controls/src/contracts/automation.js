import * as enums from '../automation/enums.js';
import { automationPropertyDefaults } from '../automation/automation-properties.js';
import { addType, addProperty, addMethod } from './contract-registration.js';

const automation = 'Microsoft.UI.Xaml.Automation.';
const peers = automation + 'Peers.';
const providers = automation + 'Provider.';
const text = automation + 'Text.';

/** Public WinUI automation declarations, allocated by the caller's A16 reservation. */
export function registerAutomationContracts(registry) {
  registerEnums(registry);
  registerProperties(registry);
  registerPeers(registry);
  registerProviders(registry);
  registerTextProviders(registry);
  registerIdentifiers(registry);
}

function registerEnums(registry) {
  const groups = [[peers, ['AutomationControlType', 'PatternInterface', 'AutomationEvents', 'AutomationLiveSetting', 'AccessibilityView',
    'AutomationHeadingLevel', 'AutomationLandmarkType', 'AutomationNotificationKind', 'AutomationNotificationProcessing']],
  [automation, ['ToggleState', 'ExpandCollapseState', 'ScrollAmount', 'SupportedTextSelection']], [text, ['TextUnit', 'TextPatternRangeEndpoint']]];
  for (const [prefix, names] of groups) for (const name of names) if (!registry.types.has(prefix + name)) registry.en(prefix + name, enums[name]);
}

function registerProperties(registry) {
  const type = automation + 'AutomationProperties';
  addType(registry, type, { kind: 'static' }, []);
  const values = { Name: 'string', AutomationId: 'string', HelpText: 'string', LabeledBy: registry.XAML + 'UIElement',
    DescribedBy: registry.XAML + 'UIElement[]', LiveSetting: peers + 'AutomationLiveSetting', HeadingLevel: peers + 'AutomationHeadingLevel',
    LandmarkType: peers + 'AutomationLandmarkType', AccessibilityView: peers + 'AccessibilityView', ItemStatus: 'string',
    PositionInSet: 'int', SizeOfSet: 'int', IsRequiredForForm: 'bool', FullDescription: 'string', LocalizedLandmarkType: 'string' };
  for (const [name, valueType] of Object.entries(values)) {
    const property = 'AutomationProperties.' + name;
    addMethod(registry, type, 'Get' + name, [registry.XAML + 'DependencyObject'], valueType,
      { isStatic: true, kind: 'attachedGet', property, defaultValue: automationPropertyDefaults[name] });
    addMethod(registry, type, 'Set' + name, [registry.XAML + 'DependencyObject', valueType], 'void',
      { isStatic: true, kind: 'attachedSet', property });
    if (!registry.types.get(type).properties[name + 'Property']) registry.prop(type, name + 'Property', registry.XAML + 'DependencyProperty', null, true, true);
  }
}

function registerPeers(registry) {
  const base = peers + 'AutomationPeer';
  const framework = peers + 'FrameworkElementAutomationPeer';
  addType(registry, base, { kind: 'abstract', base: registry.XAML + 'DependencyObject' }, []);
  addMethod(registry, base, '.ctor', [], base, { kind: 'constructor', accessibility: 'protected' });
  addType(registry, framework, { kind: 'object', base }, [[registry.XAML + 'FrameworkElement']]);
  addProperty(registry, framework, 'Owner', registry.XAML + 'FrameworkElement', null, true);
  addProperty(registry, base, 'EventsSource', base);
  for (const name of ['GetName', 'GetClassName', 'GetAutomationId', 'GetHelpText', 'GetItemStatus']) {
    addMethod(registry, base, name, [], 'string');
    addMethod(registry, base, name + 'Core', [], 'string', { isVirtual: true, accessibility: 'protected' });
  }
  for (const name of ['IsEnabled', 'IsKeyboardFocusable', 'HasKeyboardFocus', 'IsOffscreen', 'IsPassword', 'IsControlElement', 'IsContentElement']) {
    addMethod(registry, base, name, [], 'bool');
    addMethod(registry, base, name + 'Core', [], 'bool', { isVirtual: true, accessibility: 'protected' });
  }
  for (const [name, result] of [['GetAutomationControlType', peers + 'AutomationControlType'], ['GetChildren', base + '[]'],
    ['GetBoundingRectangle', 'Windows.Foundation.Rect']]) {
    addMethod(registry, base, name, [], result);
    addMethod(registry, base, name + 'Core', [], result, { isVirtual: true, accessibility: 'protected' });
  }
  addMethod(registry, base, 'GetParent', [], base);
  for (const name of ['GetPattern', 'GetPatternCore']) addMethod(registry, base, name, [peers + 'PatternInterface'], 'object',
    name.endsWith('Core') ? { isVirtual: true, accessibility: 'protected' } : {});
  for (const name of ['SetFocus', 'SetFocusCore', 'InvalidatePeer']) addMethod(registry, base, name, [], 'void',
    name.endsWith('Core') ? { isVirtual: true, accessibility: 'protected' } : {});
  addMethod(registry, base, 'RaiseAutomationEvent', [peers + 'AutomationEvents']);
  addMethod(registry, base, 'RaisePropertyChangedEvent', [automation + 'AutomationProperty', 'object', 'object']);
  addMethod(registry, base, 'RaiseNotificationEvent', [peers + 'AutomationNotificationKind', peers + 'AutomationNotificationProcessing', 'string', 'string']);
  for (const name of ['CreatePeerForElement', 'FromElement']) addMethod(registry, framework, name,
    [registry.XAML + 'UIElement'], base, { isStatic: true });
  addMethod(registry, registry.XAML + 'UIElement', 'OnCreateAutomationPeer', [], base, { isVirtual: true, accessibility: 'protected' });
  const controlPeers = ['Button', 'ToggleButton', 'CheckBox', 'RadioButton', 'ToggleSwitch', 'TextBox', 'PasswordBox', 'RichEditBox',
    'TextBlock', 'Slider', 'ProgressBar', 'ComboBox', 'ListView', 'ListViewItem', 'TabView', 'TabViewItem', 'Expander',
    'TreeView', 'TreeViewItem', 'ScrollViewer', 'Image', 'ContentDialog'];
  for (const name of controlPeers) {
    const owner = registry.CONTROLS + name;
    if (registry.types.has(owner)) addType(registry, peers + name + 'AutomationPeer', { kind: 'object', base: framework }, [[owner]]);
  }
}

function provider(registry, name, properties = {}, methods = []) {
  const type = providers + name;
  addType(registry, type, { kind: 'interface' }, []);
  for (const [property, valueType] of Object.entries(properties)) addProperty(registry, type, property, valueType, null, true);
  for (const [method, parameters = [], result = 'void'] of methods) addMethod(registry, type, method, parameters, result);
}

function registerProviders(registry) {
  provider(registry, 'IRawElementProviderSimple');
  provider(registry, 'IInvokeProvider', {}, [['Invoke']]);
  provider(registry, 'IToggleProvider', { ToggleState: automation + 'ToggleState' }, [['Toggle']]);
  provider(registry, 'IValueProvider', { IsReadOnly: 'bool', Value: 'string' }, [['SetValue', ['string']]]);
  provider(registry, 'IRangeValueProvider', { IsReadOnly: 'bool', Value: 'double', Minimum: 'double', Maximum: 'double',
    SmallChange: 'double', LargeChange: 'double' }, [['SetValue', ['double']]]);
  provider(registry, 'ISelectionProvider', { CanSelectMultiple: 'bool', IsSelectionRequired: 'bool' },
    [['GetSelection', [], providers + 'IRawElementProviderSimple[]']]);
  provider(registry, 'ISelectionItemProvider', { IsSelected: 'bool', SelectionContainer: providers + 'IRawElementProviderSimple' },
    [['Select'], ['AddToSelection'], ['RemoveFromSelection']]);
  provider(registry, 'IExpandCollapseProvider', { ExpandCollapseState: automation + 'ExpandCollapseState' }, [['Expand'], ['Collapse']]);
  provider(registry, 'IScrollProvider', { HorizontallyScrollable: 'bool', VerticallyScrollable: 'bool',
    HorizontalScrollPercent: 'double', VerticalScrollPercent: 'double', HorizontalViewSize: 'double', VerticalViewSize: 'double' },
  [['Scroll', [automation + 'ScrollAmount', automation + 'ScrollAmount']], ['SetScrollPercent', ['double', 'double']]]);
  provider(registry, 'IScrollItemProvider', {}, [['ScrollIntoView']]);
}

function registerTextProviders(registry) {
  const range = providers + 'ITextRangeProvider';
  provider(registry, 'ITextProvider', { DocumentRange: range, SupportedTextSelection: automation + 'SupportedTextSelection' },
    [['GetSelection', [], range + '[]'], ['GetVisibleRanges', [], range + '[]'],
      ['RangeFromChild', [providers + 'IRawElementProviderSimple'], range], ['RangeFromPoint', ['Windows.Foundation.Point'], range]]);
  provider(registry, 'ITextRangeProvider', {}, [['Clone', [], range], ['Compare', [range], 'bool'],
    ['CompareEndpoints', [text + 'TextPatternRangeEndpoint', range, text + 'TextPatternRangeEndpoint'], 'int'],
    ['ExpandToEnclosingUnit', [text + 'TextUnit']], ['FindText', ['string', 'bool', 'bool'], range],
    ['GetBoundingRectangles', [], 'double[]'], ['GetChildren', [], providers + 'IRawElementProviderSimple[]'],
    ['GetEnclosingElement', [], providers + 'IRawElementProviderSimple'], ['GetText', ['int'], 'string'],
    ['Move', [text + 'TextUnit', 'int'], 'int'], ['MoveEndpointByUnit', [text + 'TextPatternRangeEndpoint', text + 'TextUnit', 'int'], 'int'],
    ['MoveEndpointByRange', [text + 'TextPatternRangeEndpoint', range, text + 'TextPatternRangeEndpoint']],
    ['Select'], ['AddToSelection'], ['RemoveFromSelection'], ['ScrollIntoView', ['bool']]]);
}

function registerIdentifiers(registry) {
  addType(registry, automation + 'AutomationProperty', { kind: 'object' }, []);
  const groups = { AutomationElementIdentifiers: ['Name', 'AutomationId', 'HelpText', 'IsEnabled', 'IsKeyboardFocusable',
    'HasKeyboardFocus', 'IsOffscreen', 'ControlType', 'ClassName', 'BoundingRectangle'], TogglePatternIdentifiers: ['ToggleState'],
  ValuePatternIdentifiers: ['Value', 'IsReadOnly'], RangeValuePatternIdentifiers: ['Value', 'Minimum', 'Maximum', 'SmallChange', 'LargeChange'],
  SelectionItemPatternIdentifiers: ['IsSelected'], ExpandCollapsePatternIdentifiers: ['ExpandCollapseState'] };
  for (const [name, properties] of Object.entries(groups)) {
    const type = automation + name;
    addType(registry, type, { kind: 'static' }, []);
    for (const property of properties) if (!registry.types.get(type).properties[property + 'Property']) {
      registry.prop(type, property + 'Property', automation + 'AutomationProperty', null, true, true);
    }
  }
}
