import {frameworkType, XAML} from '@sharpforge/framework';
import {designerPropertySchema} from './metadata.js';
import {normalizeExtendedDesignerProperty} from './property-values.js';

const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw new TypeError(message); };
const nonnegative = new Set(['Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight', 'FontSize',
  'Spacing', 'RowSpacing', 'ColumnSpacing', 'Row', 'Column', 'MaxLength', 'StrokeThickness']);

/** One normalizer is shared by source import, property editors, resources, and document transactions. */
export function normalizeProperty(type, name, value) {
  const schema = designerPropertySchema(type);
  const property = schema[name];
  if (!property || property.readOnly || property.isStatic || dangerous.has(name)) {
    invalid(`Property '${name}' is not editable on ${type.split('.').at(-1)}`);
  }
  const metadata = frameworkType(property.type);
  if (value === null) {
    if (['double', 'int', 'bool'].includes(property.type) || ['enum', 'value'].includes(metadata?.kind)) {
      invalid(name + ' cannot be null; clear its local value instead');
    }
    return null;
  }
  const extended = normalizeExtendedDesignerProperty(type, name, value, schema);
  if (extended !== undefined) return extended;
  if (property.type === 'bool') {
    if (typeof value !== 'boolean') invalid(name + ' requires a Boolean');
    return value;
  }
  if (['double', 'int'].includes(property.type) || metadata?.kind === 'enum') {
    return numericProperty(name, property, metadata, value);
  }
  if (property.type === 'string' && typeof value !== 'string') invalid(name + ' requires a string');
  if (property.type === 'string' || property.type === 'object' && !object(value)) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) invalid(name + ' requires scalar content');
    if (typeof value === 'number' && !Number.isFinite(value)) invalid(name + ' requires a finite number');
    if (String(value).length > 100000) invalid('Property text limit');
    return value;
  }
  if ([XAML + 'Thickness', XAML + 'CornerRadius'].includes(property.type)) return compoundProperty(property.type, value);
  if (property.type === XAML + 'GridLength') return track(value);
  invalid(`${name} uses an object reference; edit it through the tree, styles or templates`);
}

function numericProperty(name, property, metadata, value) {
  const number = Number(value);
  if (!Number.isFinite(number) || (property.type === 'int' || metadata?.kind === 'enum') && !Number.isInteger(number)) {
    invalid(name + ' requires a finite number');
  }
  if (property.type === 'int' && (number < -2147483648 || number > 2147483647)) invalid(name + ' is outside Int32 range');
  if (metadata?.kind === 'enum' && !Object.values(metadata.values).includes(number)) invalid(name + ' is outside its enum range');
  if (nonnegative.has(name) && number < 0) invalid(name + ' cannot be negative');
  if (name.endsWith('Span') && number < 1) invalid(name + ' must be positive');
  if (name === 'Opacity' && (number < 0 || number > 1)) invalid('Opacity must be between 0 and 1');
  return number;
}

function compoundProperty(type, value) {
  const keys = type === XAML + 'Thickness' ? ['Left', 'Top', 'Right', 'Bottom'] :
    ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'];
  let numbers;
  if (typeof value === 'string') numbers = value.split(/[ ,]+/).map(Number);
  else if (typeof value === 'number') numbers = [value];
  else if (Array.isArray(value)) numbers = value;
  else if (object(value)) numbers = keys.map(key => value[key]);
  else invalid('Use one, two, or four finite values');
  if (numbers.length === 1) numbers = keys.map(() => numbers[0]);
  if (numbers.length === 2) numbers = [numbers[0], numbers[1], numbers[0], numbers[1]];
  if (numbers.length !== 4 || numbers.some(number => !Number.isFinite(number))) invalid('Use one, two, or four finite values');
  return {valueType: type, ...Object.fromEntries(keys.map((key, index) => [key, numbers[index]]))};
}

export function track(value) {
  if (object(value) && Number.isFinite(value.Value) && value.Value >= 0 && [0, 1, 2].includes(value.GridUnitType)) {
    return {valueType: XAML + 'GridLength', Value: value.Value, GridUnitType: value.GridUnitType};
  }
  const text = String(value).trim();
  if (/^auto$/i.test(text)) return {valueType: XAML + 'GridLength', Value: 1, GridUnitType: 0};
  const star = text.endsWith('*');
  const number = Number(star ? text.slice(0, -1) || 1 : text);
  if (!text || !Number.isFinite(number) || number < 0) invalid('Grid tracks use Auto, a nonnegative pixel count, *, or n*');
  return {valueType: XAML + 'GridLength', Value: number, GridUnitType: star ? 2 : 1};
}
