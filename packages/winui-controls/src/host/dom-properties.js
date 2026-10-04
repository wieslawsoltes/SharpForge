import { layoutFontFamily } from '../layout/text-format.js';

export const shortType = type => type.slice(type.lastIndexOf('.') + 1);
export const number = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
export const cssThickness = value => value
  ? `${number(value.Top)}px ${number(value.Right)}px ${number(value.Bottom)}px ${number(value.Left)}px` : '0px';

export function safeUrl(value, { image = false } = {}) {
  if (typeof value !== 'string') return '';
  let url;
  try { url = new URL(value, 'https://invalid.local/'); }
  catch (error) { if (error instanceof TypeError) return ''; throw error; }
  if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.hostname !== 'invalid.local') return value;
  if (image && /^(blob:|data:image\/(png|jpeg|webp|gif);base64,)/i.test(value) && value.length <= 8 * 1024 * 1024) return value;
  return '';
}

/** Apply paint and semantics; the layout engine alone sets geometry. */
export function applyVisualProperties(context, node, element) {
  const properties = node.properties;
  const style = element.style;
  style.display = properties.Visibility === 1 || properties.Visible === false ? 'none' : '';
  style.opacity = String(number(properties.Opacity, 1));
  style.pointerEvents = properties.IsHitTestVisible === false || properties.IsHitTestVisible === 0 ? 'none' : '';
  style.padding = properties.Padding ? cssThickness(properties.Padding) : '';
  style.borderWidth = properties.BorderThickness ? cssThickness(properties.BorderThickness) : '';
  style.borderStyle = properties.BorderThickness ? 'solid' : '';
  style.borderColor = properties.BorderBrush == null ? '' : context.color(properties.BorderBrush);
  const radius = properties.CornerRadius;
  style.borderRadius = radius ? `${number(radius.TopLeft)}px ${number(radius.TopRight)}px `
    + `${number(radius.BottomRight)}px ${number(radius.BottomLeft)}px` : '';
  style.background = properties.Background == null ? '' : context.color(properties.Background);
  style.color = properties.Foreground == null ? '' : context.color(properties.Foreground);
  const textScale = properties.IsTextScaleFactorEnabled === false ? 1 : context.services.textScale?.factor ?? 1;
  style.fontSize = properties.FontSize === undefined ? '' : number(properties.FontSize, 14) * textScale + 'px';
  style.fontFamily = properties.FontFamilyObject || properties.FontFamily
    ? String(layoutFontFamily(properties, context.resolve)).replace(/[;{}]/g, '') + ', system-ui, sans-serif' : '';
  element.draggable = !!(properties.CanDrag || properties.CanDragItems);
  style.zIndex = properties.ZIndex == null ? '' : String(properties.ZIndex);
  style.direction = properties.FlowDirection === 1 ? 'rtl' : '';
  if (properties.Name) {
    element.id = context.host.rootKey + '-' + node.id.replace(/[^a-zA-Z0-9_-]/g, '-');
    element.dataset.name = properties.Name;
  }
  if (properties.RequestedTheme) element.dataset.theme = properties.RequestedTheme === 1 ? 'light' : 'dark';
  else delete element.dataset.theme;
  const input = element.matches('input,textarea,select,button') ? element : element.querySelector(':scope > input[data-part]');
  if (input) {
    input.disabled = properties.IsEnabled === false || properties.IsEnabled === 0;
    input.tabIndex = properties.IsTabStop === false ? -1 : properties.TabIndex ?? 0;
    const explicit = properties['AutomationProperties.Name'] ?? properties.AutomationName;
    if (explicit) input.setAttribute('aria-label', String(explicit));
    else if (properties.Header && !element.querySelector('[data-header]')) input.setAttribute('aria-label', String(properties.Header));
    else input.removeAttribute('aria-label');
  }
  if (properties.IsEnabled === false || properties.IsEnabled === 0) element.setAttribute('aria-disabled', 'true');
  else element.removeAttribute('aria-disabled');
}

export function makeElement(context, tag = 'div', attributes = {}) {
  const element = context.document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function renderButtonContent(context, node, element) {
  const properties = node.properties;
  element.style.display = properties.Visibility === 1 ? 'none' : 'flex';
  element.style.alignItems = ['flex-start', 'center', 'flex-end', 'stretch'][properties.VerticalContentAlignment ?? 1];
  element.style.justifyContent = ['flex-start', 'center', 'flex-end', 'stretch'][properties.HorizontalContentAlignment ?? 1];
  element.style.padding = node.templateRoot ? '0px' : properties.Padding ? cssThickness(properties.Padding) : '0px 11px';
  element.style.lineHeight = '1.2';
  if (node.templateRoot) context.ordered(element, [context.host.ensure(node.templateRoot)].filter(Boolean));
  else context.content(element, properties.Content ?? properties.Label);
}

export function radioScope(context, node) {
  const group = node.properties.GroupName;
  const parent = context.host.layoutEngine.states.get(node.id)?.parent ?? context.host.parentOf(node.id);
  let root = parent ?? node.id;
  let ancestor = root;
  const visited = new Set();
  while (ancestor && !visited.has(ancestor)) {
    visited.add(ancestor);
    root = ancestor;
    ancestor = context.host.parentOf(ancestor);
  }
  return group ? `${context.host.rootKey}:root:${root}:group:${group}` : `${context.host.rootKey}:parent:${parent}`;
}
