import {eventsFor} from '@sharpforge/framework';

// Explicit editor defaults for WinUI controls. An unknown control never falls back to the first event.
const defaultEvents = Object.freeze({
  'Microsoft.UI.Xaml.Controls.Primitives.ButtonBase': 'Click',
  'Microsoft.UI.Xaml.Controls.Button': 'Click',
  'Microsoft.UI.Xaml.Controls.TextBox': 'TextChanged',
  'Microsoft.UI.Xaml.Controls.Primitives.Selector': 'SelectionChanged',
  'Microsoft.UI.Xaml.Controls.ComboBox': 'SelectionChanged',
  'Microsoft.UI.Xaml.Controls.ListBox': 'SelectionChanged',
  'Microsoft.UI.Xaml.Controls.ListViewBase': 'SelectionChanged',
  'Microsoft.UI.Xaml.Controls.ToggleSwitch': 'Toggled'
});

export function designerDefaultEvent(type, types) {
  const supported = eventsFor(type.name);
  const visited = new Set();
  for (let current = type; current && !visited.has(current.name); current = types.get(current.base)) {
    visited.add(current.name);
    const name = defaultEvents[current.name];
    if (name) return Object.hasOwn(supported, name) ? name : null;
  }
  return null;
}
