import { PatternInterface } from './enums.js';

export const automationNamespace = 'Microsoft.UI.Xaml.Automation.';
export const peerNamespace = automationNamespace + 'Peers.';
export const providerNamespace = automationNamespace + 'Provider.';
export const peerMethods = Object.freeze([
  'GetName', 'GetClassName', 'GetAutomationId', 'GetHelpText', 'GetItemStatus', 'IsEnabled', 'IsKeyboardFocusable',
  'HasKeyboardFocus', 'IsOffscreen', 'IsPassword', 'IsControlElement', 'IsContentElement', 'GetAutomationControlType',
  'GetChildren', 'GetBoundingRectangle', 'GetParent', 'GetPattern', 'SetFocus', 'InvalidatePeer', 'RaiseAutomationEvent',
  'RaisePropertyChangedEvent', 'RaiseNotificationEvent'
]);
export const peerCoreMethods = Object.freeze(peerMethods.filter(name => ![
  'GetParent', 'InvalidatePeer', 'RaiseAutomationEvent', 'RaisePropertyChangedEvent', 'RaiseNotificationEvent'
].includes(name)).map(name => name + 'Core'));

const descriptor = (name, properties, methods) => Object.freeze({ name, properties: Object.freeze(properties), methods: Object.freeze(methods) });
export const providerMembers = Object.freeze({
  [PatternInterface.Invoke]: descriptor('IInvokeProvider', [], ['Invoke']),
  [PatternInterface.Toggle]: descriptor('IToggleProvider', ['ToggleState'], ['Toggle']),
  [PatternInterface.Value]: descriptor('IValueProvider', ['IsReadOnly', 'Value'], ['SetValue']),
  [PatternInterface.RangeValue]: descriptor('IRangeValueProvider',
    ['IsReadOnly', 'Value', 'Minimum', 'Maximum', 'SmallChange', 'LargeChange'], ['SetValue']),
  [PatternInterface.Selection]: descriptor('ISelectionProvider', ['CanSelectMultiple', 'IsSelectionRequired'], ['GetSelection']),
  [PatternInterface.SelectionItem]: descriptor('ISelectionItemProvider', ['IsSelected', 'SelectionContainer'],
    ['Select', 'AddToSelection', 'RemoveFromSelection']),
  [PatternInterface.ExpandCollapse]: descriptor('IExpandCollapseProvider', ['ExpandCollapseState'], ['Expand', 'Collapse']),
  [PatternInterface.Scroll]: descriptor('IScrollProvider', ['HorizontallyScrollable', 'VerticallyScrollable', 'HorizontalScrollPercent',
    'VerticalScrollPercent', 'HorizontalViewSize', 'VerticalViewSize'], ['Scroll', 'SetScrollPercent']),
  [PatternInterface.ScrollItem]: descriptor('IScrollItemProvider', [], ['ScrollIntoView']),
  [PatternInterface.Text]: descriptor('ITextProvider', ['DocumentRange', 'SupportedTextSelection'],
    ['GetSelection', 'GetVisibleRanges', 'RangeFromChild', 'RangeFromPoint'])
});
export const textRangeMembers = descriptor('ITextRangeProvider', [], ['Clone', 'Compare', 'CompareEndpoints', 'ExpandToEnclosingUnit',
  'FindText', 'GetBoundingRectangles', 'GetChildren', 'GetEnclosingElement', 'GetText', 'Move', 'MoveEndpointByUnit', 'MoveEndpointByRange',
  'Select', 'AddToSelection', 'RemoveFromSelection', 'ScrollIntoView']);
export const automationIdentifiers = Object.freeze({
  AutomationElementIdentifiers: ['Name', 'AutomationId', 'HelpText', 'IsEnabled', 'IsKeyboardFocusable', 'HasKeyboardFocus',
    'IsOffscreen', 'ControlType', 'ClassName', 'BoundingRectangle'],
  TogglePatternIdentifiers: ['ToggleState'], ValuePatternIdentifiers: ['Value', 'IsReadOnly'],
  RangeValuePatternIdentifiers: ['Value', 'Minimum', 'Maximum', 'SmallChange', 'LargeChange'],
  SelectionItemPatternIdentifiers: ['IsSelected'], ExpandCollapsePatternIdentifiers: ['ExpandCollapseState']
});

/** Explicit RPC boundary shared by the browser and managed adapters. */
export function isAutomationOperation(method, pattern = null) {
  if (typeof method !== 'string') return false;
  return pattern == null ? peerMethods.includes(method) : !!providerMembers[pattern]?.methods.includes(method);
}
