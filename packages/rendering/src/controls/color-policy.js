import {normalizeBrush} from '../brushes/brushes.js';

const buttonTypes = new Set(['Button', 'ToggleButton', 'CheckBox', 'RadioButton', 'ToggleSwitch', 'ComboBox', 'ListViewItem']);

/** Use the host's computed system palette so forced colors apply equally to DOM and retained drawing. */
export function controlColorPolicy(node, services, resources, resolve) {
  if (!services.environment?.HighContrast || typeof services.systemColors !== 'function') return {node, foreground: null};
  const properties = {...node.properties}, type = node.type.split('.').at(-1);
  const disabled = properties.IsEnabled === false;
  const foreground = services.systemColors(disabled ? 'GrayText' : buttonTypes.has(type) ? 'ButtonText' : 'CanvasText');
  const background = services.systemColors(buttonTypes.has(type) ? 'ButtonFace' : 'Canvas');
  const replacement = (name, color) => {
    const value = properties[name];
    if (value == null) return;
    const brush = normalizeBrush(value, resources, resolve);
    if (brush && !(brush.kind === 'solid' && brush.color[3] * brush.opacity === 0)) properties[name] = color;
  };
  replacement('Background', background);
  for (const name of ['Foreground', 'BorderBrush', 'Fill', 'Stroke']) replacement(name, foreground);
  properties.Foreground = foreground;
  properties.FocusVisualPrimaryBrush = services.systemColors('Highlight');
  properties.FocusVisualSecondaryBrush = background;
  properties.SelectionHighlightColor = services.systemColors('Highlight');
  if (properties.SystemBackdrop) { properties.SystemBackdrop = null; properties.Background = background; }
  properties.Shadow = null;
  return {node: {...node, properties}, foreground, revision: services.environment.revision ?? 0};
}
