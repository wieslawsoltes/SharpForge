import { createPart, registerFamily, emitChange } from '../policy/events.js';
import { colorFromHex, colorToHex, rgbToHsv, hsvToRgb, constrainHsv } from './color.js';

const parts = ['color-rgb', 'color-alpha', 'color-hex', 'color-hue', 'color-saturation', 'color-value'];
const names = ['Color', 'Opacity', 'Hex color', 'Hue', 'Saturation', 'Value'];

function renderColor(context, node, element) {
  const properties = node.properties;
  const color = typeof properties.Color === 'string' ? colorFromHex(properties.Color) : properties.Color ?? { A: 255, R: 0, G: 0, B: 0 };
  const hsv = rgbToHsv(color);
  const values = [colorToHex(color), String(color.A), colorToHex(color, properties.IsAlphaEnabled),
    String(Math.round(hsv.H)), String(Math.round(hsv.S)), String(Math.round(hsv.V))];
  for (let index = 0; index < element.children.length; index++) {
    const input = element.children[index];
    input.value = values[index];
    input.disabled = properties.IsEnabled === false;
    input.removeAttribute('aria-invalid');
  }
  element.children[1].hidden = properties.IsAlphaEnabled === false;
  element.children[2].hidden = properties.IsHexInputVisible === false;
  for (let index = 3; index < 6; index++) element.children[index].hidden = properties.IsColorChannelTextInputVisible === false;
}

function colorInput(context, node, element, event) {
  if (node.properties.IsEnabled === false) return false;
  const previous = node.properties.Color ?? { A: 255, R: 0, G: 0, B: 0 };
  let color;
  try {
    const part = event.target.dataset.part;
    if (part === 'color-hex') color = colorFromHex(event.target.value, previous.A);
    else if (part === 'color-rgb') color = colorFromHex(event.target.value, previous.A);
    else if (part === 'color-alpha') color = { ...previous, A: Math.round(Number(event.target.value)) };
    else color = hsvToRgb(constrainHsv({ H: Number(element.children[3].value), S: Number(element.children[4].value),
      V: Number(element.children[5].value) }, node.properties), previous.A);
    // Validate the complete record before publishing it to the managed event channel.
    color = colorFromHex(colorToHex(color, true));
  } catch (error) {
    event.target.setAttribute('aria-invalid', 'true');
    context.emit(node, 'ValidationFailed', { Code: error.code, Message: error.message });
    return true;
  }
  node.properties.Color = color;
  renderColor(context, node, element);
  emitChange(context, node, 'ColorChanged', { OldColor: previous, NewColor: color });
  return true;
}

export function registerColorRenderer(registry) {
  registerFamily(registry, 'ColorPicker', { create(context) {
    const root = context.document.createElement('div');
    for (let index = 0; index < parts.length; index++) {
      const input = createPart(context.document, 'input', parts[index]);
      input.type = ['color', 'range', 'text', 'number', 'number', 'number'][index];
      if (index !== 0 && index !== 2) { input.min = '0'; input.max = String(index === 1 ? 255 : index === 3 ? 359 : 100); }
      input.setAttribute('aria-label', names[index]);
      root.append(input);
    }
    return root;
  }, render: renderColor, events: { input: colorInput } });
}
