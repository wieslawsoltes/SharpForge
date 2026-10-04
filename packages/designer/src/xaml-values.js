import { canonicalType, frameworkType, eventsFor } from '@sharpforge/framework';
import { normalizeProperty, propertySchema, designControls } from './model.js';

export const PRESENTATION_XMLNS = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation';
export const XAML_XMLNS = 'http://schemas.microsoft.com/winfx/2006/xaml';
export const MARKUP_XMLNS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const DESIGN_XMLNS = 'http://schemas.microsoft.com/expression/blend/2008';
const controls = new Set(designControls.map(control => control.type));
const attached = new Map([
  ['Grid.Row', 'Row'], ['Grid.Column', 'Column'], ['Grid.RowSpan', 'RowSpan'], ['Grid.ColumnSpan', 'ColumnSpan'],
  ['Canvas.Left', 'Left'], ['Canvas.Top', 'Top'], ['Canvas.ZIndex', 'ZIndex'],
  ['VariableSizedWrapGrid.RowSpan', 'WrapRowSpan'], ['VariableSizedWrapGrid.ColumnSpan', 'WrapColumnSpan']
]);

export function xamlError(code, message, source = {}) {
  const start = typeof source === 'number' ? source : source.start ?? 0;
  const end = typeof source === 'number' ? source : source.end ?? start;
  return Object.assign(new Error(message), { code, diagnostics: [{ code, severity: 'error', message, span: { start, end } }] });
}

export function xmlName(name, namespaces) {
  const colon = name.indexOf(':');
  const prefix = colon < 0 ? '' : name.slice(0, colon);
  return { name: colon < 0 ? name : name.slice(colon + 1), namespace: namespaces.get(prefix), prefix };
}

export function xamlControl(name, namespaces, source) {
  const resolved = xmlName(name, namespaces);
  const type = resolved.namespace === PRESENTATION_XMLNS ? canonicalType(resolved.name) :
    resolved.namespace?.startsWith('using:') ? resolved.namespace.slice(6) + '.' + resolved.name : null;
  if (!type || !controls.has(type)) throw xamlError('SFXAML002', 'Unsupported XAML designer control: ' + name, source);
  return type;
}

export function xamlMember(type, attribute, namespaces) {
  if (attribute.name === 'Name' || xmlName(attribute.name, namespaces).namespace === XAML_XMLNS && attribute.name.endsWith(':Name')) {
    return { kind: 'property', name: 'Name' };
  }
  const name = attached.get(attribute.name) ?? attribute.name;
  if (Object.hasOwn(propertySchema(type), name)) return { kind: 'property', name };
  if (Object.hasOwn(eventsFor(type), name)) return { kind: 'event', name };
  throw xamlError('SFXAML004', 'Unsupported XAML property or event: ' + attribute.name, attribute);
}

export function readXamlValue(type, property, value, source) {
  const schema = propertySchema(type)[property];
  if (!schema) throw xamlError('SFXAML004', 'Unsupported XAML property: ' + property, source);
  if (value.startsWith('{') && !value.startsWith('{}')) {
    throw xamlError('SFXAML005', 'Markup extensions require a supported binding/resource provider: ' + property, source);
  }
  if (value.startsWith('{}')) value = value.slice(2);
  const metadata = frameworkType(schema.type);
  if (metadata?.kind === 'enum') {
    if (!Object.hasOwn(metadata.values, value)) throw xamlError('SFXAML004', 'Unknown ' + property + ' value: ' + value, source);
    value = metadata.values[value];
  } else if (schema.type === 'bool') {
    if (!/^(true|false)$/i.test(value)) throw xamlError('SFXAML004', property + ' requires true or false', source);
    value = value.toLowerCase() === 'true';
  } else if (schema.type === 'double' || schema.type === 'int') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
      throw xamlError('SFXAML004', property + ' requires a finite number', source);
    }
    value = Number(value);
  }
  try { return normalizeProperty(type, property, value); }
  catch (error) { throw xamlError('SFXAML004', error.message, source); }
}

export function writeXamlValue(type, property, value) {
  const metadata = frameworkType(propertySchema(type)[property]?.type);
  if (metadata?.kind === 'enum') return Object.entries(metadata.values).find(([, number]) => number === value)?.[0];
  if (typeof value === 'string') return value.startsWith('{') ? '{}' + value : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value?.valueType?.endsWith('.Thickness')) return ['Left', 'Top', 'Right', 'Bottom'].map(key => value[key]).join(',');
  if (value?.valueType?.endsWith('.CornerRadius')) return ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(key => value[key]).join(',');
  if (value?.valueType?.endsWith('.SolidColorBrush')) {
    return '#' + ['A', 'R', 'G', 'B'].map(key => value.Color[key].toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  throw xamlError('SFXAML004', 'This value has no supported literal XAML representation: ' + property);
}

export function xamlAttributeName(property) {
  if (property === 'Name') return 'x:Name';
  return [...attached].find(([, value]) => value === property)?.[0] ?? property;
}

export function escapeXaml(value, quote = '"') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;')
    .replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}
