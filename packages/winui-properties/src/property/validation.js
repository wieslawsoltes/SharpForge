import {PropertyFault, UnsetValue} from './values.js';

const autoProperties = new Set(['Width', 'Height', 'ItemWidth', 'ItemHeight']);
const unboundedProperties = new Set(['MaxWidth', 'MaxHeight']);
const nonnegativeProperties = new Set([
  'Width', 'Height', 'MinWidth', 'MinHeight', 'MaxWidth', 'MaxHeight', 'FontSize', 'Spacing',
  'RowSpacing', 'ColumnSpacing', 'ItemWidth', 'ItemHeight', 'StrokeThickness'
]);
const defaultTypeOf = value => value?.valueType ?? value?.$node?.type ?? value?.type ?? null;
const primitiveNames = Object.freeze({
  'System.Object': 'object', 'System.String': 'string', 'System.Boolean': 'bool', 'System.Char': 'char',
  'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort',
  'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong',
  'System.Single': 'float', 'System.Double': 'double'
});

function nullableUnderlyingType(type) {
  const prefix = type.startsWith('System.Nullable`1<') ? 'System.Nullable`1<' : 'System.Nullable<';
  if (!type.startsWith(prefix) || !type.endsWith('>')) return null;
  const underlying = type.slice(prefix.length, -1);
  return primitiveNames[underlying] ?? underlying;
}

function reject(property, kind, message) {
  throw new PropertyFault(kind, `${property.ownerType}.${property.name}: ${message}`, {property: property.id});
}

const primitiveValidators = Object.freeze({
  object: () => true,
  string: value => value === null || typeof value === 'string',
  bool: value => typeof value === 'boolean',
  boolean: value => typeof value === 'boolean',
  int: value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647,
  uint: value => Number.isInteger(value) && value >= 0 && value <= 4294967295,
  short: value => Number.isInteger(value) && value >= -32768 && value <= 32767,
  ushort: value => Number.isInteger(value) && value >= 0 && value <= 65535,
  byte: value => Number.isInteger(value) && value >= 0 && value <= 255,
  sbyte: value => Number.isInteger(value) && value >= -128 && value <= 127,
  char: value => typeof value === 'string' && value.length === 1,
  long: value => typeof value === 'bigint' && value >= -(1n << 63n) && value < 1n << 63n,
  ulong: value => typeof value === 'bigint' && value >= 0n && value < 1n << 64n,
  float: value => typeof value === 'number',
  double: value => typeof value === 'number'
});

/** One validation table for managed and JavaScript adapters; never boxes or converts. */
export function validatePropertyValue(property, value, services = {}) {
  if (value === UnsetValue) reject(property, 'ArgumentException', 'UnsetValue is not an assignable value');
  const type = primitiveNames[property.propertyType] ?? property.propertyType;
  const underlying = nullableUnderlyingType(type);
  if (underlying !== null) {
    const kind = services.typeDefinition?.(underlying)?.kind;
    const scalar = primitiveValidators[underlying] && underlying !== 'string' && underlying !== 'object';
    if (!scalar && kind !== 'value' && kind !== 'enum') reject(property, 'ArgumentException', 'nullable requires an approved value type');
    return value === null ? null : validatePropertyValue({...property, propertyType: underlying}, value, services);
  }
  const metadata = property.metadata;
  const primitive = primitiveValidators[type];
  if (primitive && !primitive(value)) reject(property, 'ArgumentException', `requires ${type}`);
  const definition = services.typeDefinition?.(type);
  const enumValues = metadata.enumValues ?? definition?.values;
  if (enumValues && !Object.values(enumValues).includes(value)) {
    reject(property, 'ArgumentOutOfRangeException', 'invalid enumeration value');
  }
  if (!primitive && !enumValues && value !== null) {
    const actual = (services.typeOf ?? defaultTypeOf)(value);
    if (type === 'Microsoft.UI.Xaml.DependencyProperty' && value?.kind === 'DependencyProperty') {
      services.registry?.resolve(value);
    } else if (!actual || !(services.isAssignable?.(type, actual) ?? actual === type)) {
      reject(property, 'ArgumentException', `requires ${type}`);
    }
  }
  if (value === null && definition?.kind === 'value') reject(property, 'ArgumentException', 'value type cannot be null');
  if (type === 'double' || type === 'float') validateNumber(property, value);
  if (typeof value === 'number') validateRange(property, value);
  if (value !== null && metadata.structFields) validateStruct(property, value, metadata.structFields);
  return value;
}

function validateNumber(property, value) {
  if (Number.isFinite(value)) return;
  if (Number.isNaN(value) && (property.metadata.allowNaN || autoProperties.has(property.name))) return;
  if (value === Infinity && (property.metadata.allowInfinity || unboundedProperties.has(property.name))) return;
  reject(property, 'ArgumentException', 'requires a finite numeric value');
}

function validateRange(property, value) {
  const metadata = property.metadata;
  const minimum = metadata.minimum ?? (nonnegativeProperties.has(property.name) ? 0 : -Infinity);
  const maximum = metadata.maximum ?? Infinity;
  if (value < minimum || value > maximum) reject(property, 'ArgumentOutOfRangeException', 'value is outside the property range');
  if (property.name === 'Opacity' && (value < 0 || value > 1)) {
    reject(property, 'ArgumentOutOfRangeException', 'opacity must be between zero and one');
  }
  if (property.name === 'SpeedRatio' && (value <= 0 || value > 1000)) {
    reject(property, 'ArgumentOutOfRangeException', 'speed ratio must be positive and at most 1000');
  }
}

function validateStruct(property, value, fields) {
  for (const [name, type] of Object.entries(fields)) {
    if (!Object.hasOwn(value, name) || !primitiveValidators[type]?.(value[name])) {
      reject(property, 'ArgumentException', `invalid value-struct field '${name}'`);
    }
  }
}

/** CLR-compatible primitive defaults used when registration omits metadata. */
export function defaultPropertyValue(type, definition = null) {
  type = primitiveNames[type] ?? type;
  if (nullableUnderlyingType(type) !== null) return null;
  if (type === 'bool' || type === 'boolean') return false;
  if (type === 'long' || type === 'ulong') return 0n;
  if (primitiveValidators[type] && type !== 'object' && type !== 'string' && type !== 'char') return 0;
  if (definition?.kind === 'enum') return 0;
  if (definition?.kind === 'value') {
    const value = {valueType: type};
    for (const name of definition.slots ?? []) value[name] = 0;
    for (const [name, property] of Object.entries(definition.properties ?? {})) {
      if (!property.isStatic && !Object.hasOwn(value, name)) {
        value[name] = property.value ?? (primitiveValidators[property.type] ? defaultPropertyValue(property.type) : null);
      }
    }
    if (type.endsWith('.Duration')) value.kind = 'auto';
    if (type.endsWith('.RepeatBehavior')) value.Count = 1;
    return Object.freeze(value);
  }
  return type === 'char' ? '\0' : null;
}
