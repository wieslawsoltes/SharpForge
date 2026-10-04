import { ControlError, registerFamily, controlName } from '../policy/events.js';
import { HostPermissionPolicy } from '../policy/capabilities.js';

const symbolCodepoints = Object.freeze({ Accept: 0xe10b, Add: 0xe109, Back: 0xe112, Cancel: 0xe10a,
  Clear: 0xe106, Copy: 0xe16f, Cut: 0xe16b, Delete: 0xe107, Edit: 0xe104, Favorite: 0xe113,
  Find: 0xe11a, Forward: 0xe111, Home: 0xe10f, More: 0xe10c, Next: 0xe101, Paste: 0xe16d,
  Pause: 0xe103, Play: 0xe102, Previous: 0xe100, Refresh: 0xe149, Save: 0xe105, Setting: 0xe115,
  Stop: 0xe15b, Undo: 0xe10e, Redo: 0xe10d, ZoomIn: 0xe12e, ZoomOut: 0xe1a4 });

export function symbolGlyph(symbol) {
  const code = typeof symbol === 'number' ? symbol : symbolCodepoints[symbol];
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) {
    throw new ControlError('SFUI16C0', `Unknown symbol ${String(symbol)}`);
  }
  return String.fromCodePoint(code);
}

export function iconProperties(context, value) {
  if (value?.$ref) {
    const node = context.nodes.get(value.$ref);
    return node ? { ...node.properties, $type: node.type } : {};
  }
  return value && typeof value === 'object' ? value : {};
}

function renderPath(context, properties, element) {
  const source = iconProperties(context, properties.Data);
  const data = typeof properties.Data === 'string' ? properties.Data : source.Data ?? source.Path ?? '';
  if (data.length > 1_048_576 || !/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\-\s]*$/.test(data)) {
    throw new ControlError('SFUI16C1', 'PathIcon requires bounded SVG path data');
  }
  const svg = context.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = context.document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('viewBox', properties.ViewBox ?? '0 0 20 20');
  svg.setAttribute('width', '1em'); svg.setAttribute('height', '1em');
  path.setAttribute('d', data); path.setAttribute('fill', 'currentColor');
  svg.append(path); element.replaceChildren(svg);
}

function renderIcon(context, node, element) {
  const kind = controlName(node), p = kind === 'IconSourceElement' ? iconProperties(context, node.properties.IconSource) : node.properties;
  const sourceType = p.$type?.split('.').at(-1) ?? kind;
  element.setAttribute('aria-hidden', 'true');
  element.style.display = 'inline-flex'; element.style.alignItems = element.style.justifyContent = 'center';
  if (sourceType === 'PathIcon' || sourceType === 'PathIconSource' || p.Data) renderPath(context, p, element);
  else if (sourceType === 'BitmapIconSource' || sourceType === 'ImageIconSource' || p.UriSource || p.ImageSource) {
    const properties = p.ImageSource ? iconProperties(context, p.ImageSource) : p;
    const image = context.document.createElement('img');
    image.alt = '';
    image.src = (context.services.permissions ?? new HostPermissionPolicy()).url(properties.UriSource,
      { capability: 'image', image: true });
    image.style.width = image.style.height = '1em';
    image.style.objectFit = 'contain';
    element.replaceChildren(image);
  }
  else {
    const symbol = p.Symbol;
    element.textContent = p.Glyph ?? (symbol === undefined ? '' : symbolGlyph(symbol));
    element.style.fontFamily = p.FontFamily ?? 'Segoe Fluent Icons, Segoe MDL2 Assets, sans-serif';
    element.style.fontSize = (p.FontSize ?? 20) + 'px';
    element.style.fontWeight = p.FontWeight?.Weight ?? p.FontWeight ?? 400;
  }
  element.style.transform = p.MirroredWhenRightToLeft && node.properties.FlowDirection === 1 ? 'scaleX(-1)' : '';
}

/** Render a source descriptor through the same glyph/image/path implementation as IconSourceElement. */
export function renderIconSource(context, value, element) {
  renderIcon(context, { type: 'Microsoft.UI.Xaml.Controls.IconSourceElement', properties: { IconSource: value } }, element);
}

export function registerIconRenderers(registry) {
  registerFamily(registry, ['FontIcon', 'SymbolIcon', 'PathIcon', 'IconSourceElement'], {
    create: context => context.document.createElement('span'), render: renderIcon
  });
}
