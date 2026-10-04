import { addType, addProperty, addMethod, addEvent } from './contract-registration.js';

const X = 'Microsoft.UI.Xaml.', V = 'Windows.UI.ViewManagement.';
function typedEvent(registry, owner, name, argument = 'object') {
  const delegate = 'Windows.Foundation.TypedEventHandler`2<' + owner + ',' + argument + '>';
  if (!registry.types.has(delegate)) registry.delegate(delegate, [owner, argument]);
  addEvent(registry, owner, name, delegate);
}

/** Additive responsive-environment contracts; browser capability limits live at the adapter boundary. */
export function registerEnvironmentContracts(registry) {
  addType(registry, X + 'XamlRoot', { kind: 'object' }, []);
  addType(registry, X + 'XamlRootChangedEventArgs', { kind: 'object' }, []);
  addProperty(registry, X + 'UIElement', 'XamlRoot', X + 'XamlRoot');
  for (const [name, type, value] of [['Content', X + 'UIElement', null], ['Size', 'Windows.Foundation.Size', null],
    ['RasterizationScale', 'double', 1], ['IsHostVisible', 'bool', true]]) addProperty(registry, X + 'XamlRoot', name, type, value, true);
  typedEvent(registry, X + 'XamlRoot', 'Changed', X + 'XamlRootChangedEventArgs');
  addType(registry, V + 'UISettings', { kind: 'object' });
  addProperty(registry, V + 'UISettings', 'TextScaleFactor', 'double', 1, true);
  addProperty(registry, V + 'UISettings', 'AnimationsEnabled', 'bool', true, true);
  typedEvent(registry, V + 'UISettings', 'TextScaleFactorChanged');
  typedEvent(registry, V + 'UISettings', 'AnimationsEnabledChanged');
  addType(registry, V + 'AccessibilitySettings', { kind: 'object' });
  addProperty(registry, V + 'AccessibilitySettings', 'HighContrast', 'bool', false, true);
  addProperty(registry, V + 'AccessibilitySettings', 'HighContrastScheme', 'string', '', true);
  typedEvent(registry, V + 'AccessibilitySettings', 'HighContrastChanged');
  addType(registry, V + 'InputPane', { kind: 'object' }, []);
  addType(registry, V + 'InputPaneVisibilityEventArgs', { kind: 'object' }, []);
  addProperty(registry, V + 'InputPane', 'OccludedRect', 'Windows.Foundation.Rect', null, true);
  addProperty(registry, V + 'InputPaneVisibilityEventArgs', 'OccludedRect', 'Windows.Foundation.Rect', null, true);
  addProperty(registry, V + 'InputPaneVisibilityEventArgs', 'EnsuredFocusedElementInView', 'bool', false);
  addMethod(registry, V + 'InputPane', 'GetForCurrentView', [], V + 'InputPane', { isStatic: true });
  for (const method of ['TryShow', 'TryHide']) addMethod(registry, V + 'InputPane', method, [], 'bool');
  for (const event of ['Showing', 'Hiding']) typedEvent(registry, V + 'InputPane', event, V + 'InputPaneVisibilityEventArgs');
}
