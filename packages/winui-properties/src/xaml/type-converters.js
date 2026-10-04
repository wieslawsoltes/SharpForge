import {xamlFault} from './diagnostics.js';
import {xamlNamedColors} from './known-colors.js';

const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function number(value, context) {
  if (!numberPattern.test(value)) throw xamlFault('SFXAML020', `Invalid numeric literal '${value}'.`, context);
  const result = Number(value);
  if (!Number.isFinite(result)) throw xamlFault('SFXAML020', 'Numeric literal exceeds the finite range.', context);
  return result;
}

function components(text, counts, context) {
  if (/^\s*,|,\s*,|,\s*$/.test(text)) throw xamlFault('SFXAML021', 'A component cannot be empty.', context);
  const parts = text.trim().split(/[\s,]+/);
  if (!counts.includes(parts.length)) throw xamlFault('SFXAML021', `Expected ${counts.join(' or ')} numeric components.`, context);
  return parts.map(part => number(part, context));
}

function thickness(text, context) {
  const values = components(text, [1, 2, 3, 4], context);
  // WinUI's documented three-component spelling ignores the third component.
  if (values.length === 3) values.length = 2;
  const [left, top = left, right = left, bottom = top] = values;
  return Object.freeze({left, top, right, bottom});
}

function cornerRadius(text, context) {
  const values = components(text, [1, 4], context);
  if (values.some(value => value < 0)) throw xamlFault('SFXAML022', 'CornerRadius cannot be negative.', context);
  const [topLeft, topRight = topLeft, bottomRight = topLeft, bottomLeft = topLeft] = values;
  return Object.freeze({topLeft, topRight, bottomRight, bottomLeft});
}

function gridLength(text, context) {
  if (text === 'Auto') return Object.freeze({value: 1, unitType: 'Auto'});
  const star = text.endsWith('*');
  const value = star && text === '*' ? 1 : number(star ? text.slice(0, -1) : text, context);
  if (value < 0) throw xamlFault('SFXAML023', 'GridLength cannot be negative.', context);
  return Object.freeze({value, unitType: star ? 'Star' : 'Pixel'});
}

export function convertXamlColor(text, context = {}) {
  if (typeof text !== 'string' || text.length > 16384) throw xamlFault('SFXAML024', 'Invalid color literal input.', context);
  text = text.trim();
  if (Object.hasOwn(xamlNamedColors, text.toLowerCase())) return xamlNamedColors[text.toLowerCase()];
  if (!/^#[\da-f]+$/i.test(text)) throw xamlFault('SFXAML024', `Unknown color literal '${text}'.`, context);
  const digits = text.slice(1).toLowerCase();
  if (digits.length === 3) return '#ff' + [...digits].map(value => value + value).join('');
  if (digits.length === 4) return '#' + [...digits].map(value => value + value).join('');
  if (digits.length === 6) return '#ff' + digits;
  if (digits.length === 8) return '#' + digits;
  throw xamlFault('SFXAML024', 'Color literals require 3, 4, 6 or 8 hexadecimal digits.', context);
}

function timespan(text, context) {
  if (/^-?\d{1,8}$/.test(text)) text += '.0:0:0';
  const match = /^(-)?(?:(\d{1,8})\.)?(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,7}))?$/.exec(text);
  if (!match) throw xamlFault('SFXAML025', 'Expected a [days.]hours:minutes:seconds[.fraction] duration.', context);
  const [, sign, days, hours, minutes, seconds, fraction = ''] = match;
  if (+minutes > 59 || +seconds > 59 || +hours > 23) throw xamlFault('SFXAML025', 'Invalid duration component.', context);
  const ticks = ((BigInt(days ?? 0) * 24n + BigInt(hours)) * 3600n + BigInt(minutes) * 60n + BigInt(seconds)) * 10000000n;
  const result = (sign ? -1n : 1n) * (ticks + BigInt(fraction.padEnd(7, '0') || '0'));
  if (result < -9223372036854775808n || result > 9223372036854775807n) {
    throw xamlFault('SFXAML025', 'TimeSpan exceeds its signed 64-bit tick range.', context);
  }
  return result;
}

function duration(text, context) {
  if (text === 'Automatic' || text === 'Forever') return Object.freeze({kind: text});
  const ticks = timespan(text, context);
  if (ticks < 0n) throw xamlFault('SFXAML025', 'Duration cannot be negative.', context);
  return Object.freeze({kind: 'TimeSpan', ticks});
}

function keyTime(text, context) {
  const ticks = timespan(text, context);
  if (ticks < 0n) throw xamlFault('SFXAML025', 'KeyTime cannot be negative.', context);
  return Object.freeze({ticks});
}

function fontWeight(text, context) {
  const names = {Thin: 100, ExtraLight: 200, UltraLight: 200, Light: 300, SemiLight: 350, Normal: 400,
    Regular: 400, Medium: 500, SemiBold: 600, DemiBold: 600, Bold: 700, ExtraBold: 800, UltraBold: 800,
    Black: 900, Heavy: 900, ExtraBlack: 950, UltraBlack: 950};
  const weight = Object.hasOwn(names, text) ? names[text] : number(text, context);
  if (!Number.isInteger(weight) || weight < 1 || weight > 999) throw xamlFault('SFXAML026', 'FontWeight must be in [1, 999].', context);
  return Object.freeze({weight});
}

const converters = Object.freeze({
  Thickness: thickness,
  CornerRadius: cornerRadius,
  GridLength: gridLength,
  Color: convertXamlColor,
  Brush: (text, context) => Object.freeze({kind: 'SolidColorBrush', color: convertXamlColor(text, context), opacity: 1}),
  SolidColorBrush: (text, context) => Object.freeze({kind: 'SolidColorBrush', color: convertXamlColor(text, context), opacity: 1}),
  Point: (text, context) => { const [x, y] = components(text, [2], context); return Object.freeze({x, y}); },
  Size: (text, context) => { const [width, height] = components(text, [2], context); return Object.freeze({width, height}); },
  Rect: (text, context) => { const [x, y, width, height] = components(text, [4], context); return Object.freeze({x, y, width, height}); },
  Vector2: (text, context) => { const [x, y] = components(text, [2], context); return Object.freeze({x, y}); },
  Duration: duration,
  KeyTime: keyTime,
  TimeSpan: (text, context) => Object.freeze({ticks: timespan(text, context)}),
  FontWeight: fontWeight,
  FontFamily: text => text,
  Uri: text => Object.freeze({uri: text})
});

const integerRanges = Object.freeze({
  byte: [0, 255], sbyte: [-128, 127], short: [-32768, 32767], ushort: [0, 65535],
  int: [-2147483648, 2147483647], uint: [0, 4294967295]
});
const integerNames = Object.freeze({Byte: 'byte', SByte: 'sbyte', Int16: 'short', UInt16: 'ushort', Int32: 'int', UInt32: 'uint',
  Int64: 'long', UInt64: 'ulong'});

function integerLiteral(text, name, context) {
  if (!/^[+-]?\d+$/.test(text)) throw xamlFault('SFXAML029', `Invalid ${name} literal.`, context);
  if (name === 'long' || name === 'ulong') {
    const value = BigInt(text), minimum = name === 'long' ? -9223372036854775808n : 0n;
    const maximum = name === 'long' ? 9223372036854775807n : 18446744073709551615n;
    if (value < minimum || value > maximum) throw xamlFault('SFXAML029', `Invalid ${name} literal.`, context);
    return value;
  }
  const value = Number(text), [minimum, maximum] = integerRanges[name];
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw xamlFault('SFXAML029', `Invalid ${name} literal.`, context);
  return value;
}

/** Closed literal conversion shared by XAML, binding and designer editors; never evaluates source text. */
export function convertXamlValue(text, targetType, context = {}) {
  if (typeof text !== 'string' || text.length > 16384) throw xamlFault('SFXAML027', 'XAML literals require a string of at most 16384 characters.', context);
  const name = typeof targetType === 'string' ? targetType : targetType?.name;
  if (typeof name !== 'string' || !name) throw xamlFault('SFXAML032', 'A registered literal target type is required.', context);
  const localName = name.slice(name.lastIndexOf('.') + 1);
  if (name === 'string' || name === 'object' || localName === 'String') return text;
  const trimmed = text.trim();
  if (name === 'bool' || localName === 'Boolean') {
    if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
    throw xamlFault('SFXAML028', 'Boolean literals must be True or False.', context);
  }
  if (['double', 'float', 'Double', 'Single'].includes(localName)) {
    if (trimmed === 'NaN' || trimmed === 'Auto') return NaN;
    if (trimmed === 'Infinity' || trimmed === '+Infinity') return Infinity;
    if (trimmed === '-Infinity') return -Infinity;
    const value = number(trimmed, context);
    const result = localName === 'float' || localName === 'Single' ? Math.fround(value) : value;
    if (!Number.isFinite(result)) throw xamlFault('SFXAML020', 'Numeric literal exceeds the target type range.', context);
    return result;
  }
  const integerName = Object.hasOwn(integerNames, localName) ? integerNames[localName] : name;
  if (Object.hasOwn(integerRanges, integerName) || integerName === 'long' || integerName === 'ulong') {
    return integerLiteral(trimmed, integerName, context);
  }
  const type = typeof targetType === 'object' ? targetType : context.type?.(name);
  const values = type && typeof type === 'object' && Object.hasOwn(type, 'values') ? type.values : null;
  if (values && typeof values === 'object') return convertEnum(trimmed, type, context);
  if (name === 'System.Type') {
    const resolved = context.resolveType?.(trimmed);
    if (!resolved) throw xamlFault('SFXAML030', `Unknown type '${trimmed}'.`, context);
    return resolved;
  }
  if (localName === 'Geometry') {
    if (!context.parseGeometry) throw xamlFault('SFXAML031', 'Geometry conversion requires a registered geometry parser.', context);
    return context.parseGeometry(trimmed, context);
  }
  const converter = context.converters?.get(name) ?? (Object.hasOwn(converters, localName) ? converters[localName] : null);
  if (!converter) throw xamlFault('SFXAML032', `No registered literal converter for '${name}'.`, context);
  return converter(trimmed, context);
}

function convertEnum(text, type, context) {
  if (Object.hasOwn(type.values, text)) return type.values[text];
  const names = text.split(',').map(value => value.trim());
  if (type.flags && names.every(name => Object.hasOwn(type.values, name))) {
    return names.reduce((result, name) => result | type.values[name], 0);
  }
  if (/^[+-]?\d+$/.test(text)) {
    const value = Number(text);
    if (Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647) return value;
  }
  throw xamlFault('SFXAML033', `Unknown ${type.name} enumeration value '${text}'.`, context);
}
