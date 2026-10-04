import {MEDIA, XAML, frameworkType} from '@sharpforge/framework';
import {authoringError} from './property-diagnostics.js';

export const quoteDesignerString = value => JSON.stringify(String(value)).replace(/\u2028|\u2029/g, ' ');
export const designerSymbol = value => 'v_' + value.replace(/[^A-Za-z0-9_]/g, '_');

function colorExpression(color) {
  return `Windows.UI.Color.FromArgb(${color.A}, ${color.R}, ${color.G}, ${color.B})`;
}

/** Deterministic typed C# literals, including compact uniform values and WinUI gradient constructors. */
export function csharpValue(value, type) {
  if (value === null) return 'null';
  if (type === 'bool') return value ? 'true' : 'false';
  if (type === 'string' || typeof value === 'string') return quoteDesignerString(value);
  const enumeration = frameworkType(type);
  if (enumeration?.kind === 'enum') {
    const name = Object.entries(enumeration.values).find(([, item]) => item === value)?.[0];
    if (name) return enumeration.name + '.' + name;
    if (enumeration.flags) return `(${enumeration.name})${value}`;
    authoringError('SFD1870', 'Unknown generated enum value.');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) authoringError('SFD1870', 'Generated numeric values must be finite.');
    return String(value) + (type === 'double' && Number.isInteger(value) ? '.0' : '');
  }
  if (typeof value === 'boolean') return String(value);
  if (value.valueType === MEDIA + 'SolidColorBrush') {
    const expression = `new ${MEDIA}SolidColorBrush(${colorExpression(value.Color)})`;
    return value.Opacity !== undefined ? `${expression} { Opacity = ${value.Opacity} }` : expression;
  }
  if (value.valueType === MEDIA + 'LinearGradientBrush') {
    const point = value => `new Windows.Foundation.Point(${value.X}, ${value.Y})`;
    const stops = value.GradientStops.map(stop =>
      `new ${MEDIA}GradientStop() { Color = ${colorExpression(stop.Color)}, Offset = ${stop.Offset} }`);
    return `new ${MEDIA}LinearGradientBrush() { StartPoint = ${point(value.StartPoint)}, EndPoint = ${point(value.EndPoint)}, ` +
      `Opacity = ${value.Opacity}, GradientStops = { ${stops.join(', ')} } }`;
  }
  const fields = value.valueType === XAML + 'Thickness' ? ['Left', 'Top', 'Right', 'Bottom'] :
    value.valueType === XAML + 'CornerRadius' ? ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] : null;
  if (fields) {
    const values = fields.map(key => value[key]);
    const argumentsText = values.every(number => number === values[0]) ? String(values[0]) : values.join(', ');
    return `new ${value.valueType}(${argumentsText})`;
  }
  if (value.valueType === XAML + 'GridLength') {
    return `new ${XAML}GridLength(${value.Value}, ${XAML}GridUnitType.${['Auto', 'Pixel', 'Star'][value.GridUnitType]})`;
  }
  authoringError('SFD1870', 'Unsupported generated property value.');
}
