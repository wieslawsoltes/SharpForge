import {MAX, fail} from '../host.js';
import {formatBclValue} from './number-format.js';

const digit = character => character >= '0' && character <= '9';

function invalid(platform) {
  fail(platform, 'FormatException', 'Invalid composite format item');
}

function number(platform, format, position) {
  if (!digit(format[position])) invalid(platform);
  let value = 0;
  // The CLR stops consuming digits once the accumulated value reaches one million.
  do {
    value = value * 10 + format.charCodeAt(position++) - 48;
  } while (digit(format[position]) && value < 1_000_000);
  return {value, position};
}

function spaces(format, position) {
  while (format[position] === ' ') position++;
  return position;
}

function item(platform, format, position, args) {
  const index = number(platform, format, position);
  position = spaces(format, index.position);
  let alignment = 0;
  if (format[position] === ',') {
    position = spaces(format, position + 1);
    const negative = format[position] === '-';
    if (negative) position++;
    const width = number(platform, format, position);
    alignment = negative ? -width.value : width.value;
    position = spaces(format, width.position);
  }
  let specifier = '';
  if (format[position] === ':') {
    const start = ++position;
    while (position < format.length && format[position] !== '}') {
      if (format[position] === '{') invalid(platform);
      position++;
    }
    specifier = format.slice(start, position);
  }
  if (format[position] !== '}' || index.value >= args.length) invalid(platform);
  const value = formatBclValue(platform, args[index.value], specifier);
  if (Math.abs(alignment) > MAX) fail(platform, 'OutOfMemoryException', 'Composite format host text limit exceeded');
  const text = alignment < 0 ? value.padEnd(-alignment) : value.padStart(alignment);
  return {text, position: position + 1};
}

/** Scan in linear time and emit completed runs, preserving StringBuilder's partial writes on a later error. */
export function appendCompositeFormat(platform, format, args, append) {
  if (format === null || args === null) fail(platform, 'ArgumentNullException', 'Format and arguments are required');
  let position = 0;
  let literalStart = 0;
  const literal = [];
  while (position < format.length) {
    const character = format[position];
    if (character !== '{' && character !== '}') {
      position++;
      continue;
    }
    literal.push(format.slice(literalStart, position));
    if (format[position + 1] === character) {
      literal.push(character);
      position += 2;
      literalStart = position;
      continue;
    }
    const text = literal.join('');
    if (text) append(text);
    literal.length = 0;
    if (character === '}') invalid(platform);
    const parsed = item(platform, format, position + 1, args);
    append(parsed.text);
    position = parsed.position;
    literalStart = position;
  }
  literal.push(format.slice(literalStart));
  const text = literal.join('');
  if (text) append(text);
}

/** Format .NET composite items within the host's UTF-16 text budget; malformed items raise FormatException. */
export function compositeFormat(platform, format, args) {
  const parts = [];
  let length = 0;
  appendCompositeFormat(platform, format, args, value => {
    length += value.length;
    if (length > MAX) fail(platform, 'OutOfMemoryException', 'Composite format host text limit exceeded');
    parts.push(value);
  });
  return parts.join('');
}
