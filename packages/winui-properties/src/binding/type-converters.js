import {convertXamlValue} from '../xaml/type-converters.js';
import {UnsetValue} from '../property/values.js';

/** Materialize literal data into the same typed values consumed by either property host. */
export function materializePropertyLiteral(type, data, {typeDefinition = () => null, createBrush} = {}) {
  const name = type.slice(type.lastIndexOf('.') + 1);
  if (name === 'Color' && typeof data === 'string') {
    const bits = Number.parseInt(data.slice(1), 16);
    return Object.freeze({valueType: type, A: bits >>> 24, R: bits >>> 16 & 255, G: bits >>> 8 & 255, B: bits & 255});
  }
  if (name === 'Brush' || name === 'SolidColorBrush') {
    const color = materializePropertyLiteral('Windows.UI.Color', data.color);
    return createBrush?.(color) ?? Object.freeze({valueType: 'Microsoft.UI.Xaml.Media.SolidColorBrush', Color: color, Opacity: data.opacity});
  }
  if (!data || typeof data !== 'object') return data;
  if (name === 'GridLength') {
    return Object.freeze({valueType: type, Value: data.value, GridUnitType: {Auto: 0, Pixel: 1, Star: 2}[data.unitType]});
  }
  if (name === 'TimeSpan' || name === 'KeyTime' || name === 'Duration') {
    if (name === 'Duration' && data.kind !== 'TimeSpan') return Object.freeze({valueType: type, kind: data.kind.toLowerCase()});
    const time = Object.freeze({valueType: 'System.TimeSpan', TotalMilliseconds: Number(data.ticks) / 10000,
      TotalSeconds: Number(data.ticks) / 10000000});
    return name === 'TimeSpan' ? time : Object.freeze({valueType: type, TimeSpan: time});
  }
  const result = {valueType: type};
  const definition = typeDefinition(type);
  const fields = Object.keys(definition?.properties ?? {});
  for (const [key, value] of Object.entries(data)) {
    const field = fields.find(candidate => candidate.toLowerCase() === key.toLowerCase()) ?? key[0].toUpperCase() + key.slice(1);
    result[field] = value;
  }
  return Object.freeze(result);
}

/** Shared binding literal conversion; custom IValueConverter always takes precedence. */
export function convertBindingValue(value, targetType, services = {}) {
  if (value === UnsetValue || value === null || targetType === 'object') return value;
  if (targetType === 'string') return String(value);
  if (typeof value !== 'string') return value;
  const converted = convertXamlValue(value, targetType, {type: services.typeDefinition,
    resolveType: services.resolveType, parseGeometry: services.parseGeometry, converters: services.converters});
  return services.materialize?.(targetType, converted) ?? materializePropertyLiteral(targetType, converted, services);
}
