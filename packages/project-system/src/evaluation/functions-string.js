import { fail, number, formatValue } from './errors.js';

function range(value, start, length = value.length - start) {
  start = number(start, true);
  length = number(length, true);
  if (start < 0 || length < 0 || start + length > value.length) fail('String index and length are outside the string.');
  return [start, length];
}

function comparison(value, other, mode = '') {
  mode = String(mode).replace(/^System\.StringComparison\./, '');
  if (mode && !['Ordinal', 'OrdinalIgnoreCase', 'InvariantCulture', 'InvariantCultureIgnoreCase'].includes(mode)) {
    fail(`StringComparison '${mode}' is not deterministic in the portable evaluator.`);
  }
  return mode.endsWith('IgnoreCase') ? [value.toUpperCase(), String(other).toUpperCase()] : [value, String(other)];
}

function trim(value, args, start, end) {
  const chars = args.length ? new Set(args.flatMap(item => Array.isArray(item) ? item : [...String(item)])) : null;
  const removable = char => chars ? chars.has(char) : /\s/.test(char);
  let first = 0;
  let last = value.length;
  if (start) while (first < last && removable(value[first])) first++;
  if (end) while (last > first && removable(value[last - 1])) last--;
  return value.slice(first, last);
}

const methods = {
  length: value => value.length,
  substring(value, args) {
    const [start, length] = range(value, args[0], args[1]);
    return value.slice(start, start + length);
  },
  replace(value, args) {
    if (!String(args[0]).length) fail('Replace oldValue cannot be empty.');
    return value.split(String(args[0])).join(String(args[1] ?? ''));
  },
  trim: (value, args) => trim(value, args, true, true),
  trimstart: (value, args) => trim(value, args, true, false),
  trimend: (value, args) => trim(value, args, false, true),
  tolower: value => value.toLowerCase(),
  tolowerinvariant: value => value.toLowerCase(),
  toupper: value => value.toUpperCase(),
  toupperinvariant: value => value.toUpperCase(),
  contains(value, args) {
    const [left, right] = comparison(value, args[0], args[1]);
    return left.includes(right);
  },
  startswith(value, args) {
    const [left, right] = comparison(value, args[0], args[1]);
    return left.startsWith(right);
  },
  endswith(value, args) {
    const [left, right] = comparison(value, args[0], args[1]);
    return left.endsWith(right);
  },
  indexof(value, args) {
    const hasStart = args.length > 1 && /^\d+$/.test(String(args[1]));
    const [left, right] = comparison(value, args[0], hasStart ? args[3] : args[1]);
    const start = hasStart ? number(args[1], true) : 0;
    const count = hasStart && typeof args[2] !== 'undefined' ? number(args[2], true) : value.length - start;
    range(value, start, count);
    const found = left.slice(start, start + count).indexOf(right);
    return found < 0 ? -1 : found + start;
  },
  lastindexof(value, args) {
    const hasStart = args.length > 1 && /^\d+$/.test(String(args[1]));
    const [left, right] = comparison(value, args[0], hasStart ? args[3] : args[1]);
    const start = hasStart ? number(args[1], true) : Math.max(0, value.length - 1);
    if (start < 0 || start >= value.length && value.length) fail('LastIndexOf index is outside the string.');
    const count = hasStart && args[2] !== undefined ? number(args[2], true) : start + 1;
    if (count < 0 || count > start + 1) fail('LastIndexOf count is outside the string.');
    const first = start - count + 1;
    const found = left.lastIndexOf(right, start);
    return found < first ? -1 : found;
  },
  split(value, args) {
    let separators = args[0] === undefined || args[0] === '' ? null : Array.isArray(args[0]) ? args[0] : [...String(args[0])];
    const options = String(args.at(-1) ?? '');
    const pattern = separators?.map(char => String(char).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    let result = separators ? value.split(new RegExp(pattern)) : value.split(/\s/);
    if (/TrimEntries/.test(options)) result = result.map(item => item.trim());
    if (/RemoveEmptyEntries/.test(options)) result = result.filter(Boolean);
    const limit = args.length > 1 && /^\d+$/.test(String(args[1])) ? number(args[1], true) : Infinity;
    if (result.length > limit) fail('Split with a maximum count is not supported for this overload.');
    return result;
  },
  padleft(value, args) {
    const width = number(args[0], true);
    if (width < 0 || width > 65536 || String(args[1] ?? ' ').length !== 1) fail('Invalid or excessive PadLeft arguments.');
    return value.padStart(width, String(args[1] ?? ' '));
  },
  padright(value, args) {
    const width = number(args[0], true);
    if (width < 0 || width > 65536 || String(args[1] ?? ' ').length !== 1) fail('Invalid or excessive PadRight arguments.');
    return value.padEnd(width, String(args[1] ?? ' '));
  },
  equals(value, args) {
    const [left, right] = comparison(value, args[0], args[1]);
    return left === right;
  },
  get_item(value, args) {
    const [start] = range(value, args[0], 1);
    return value[start];
  },
  tostring: value => value,
  tochararray: value => [...value],
};

/** Invoke the deterministic allow-list; unknown members fail instead of becoming empty properties. */
export function invokeStringMember(receiver, member, args = []) {
  const key = member.toLowerCase();
  if (Array.isArray(receiver)) {
    if (key === 'length' || key === 'count') return receiver.length;
    if (key === 'get_item') {
      const index = number(args[0], true);
      if (index < 0 || index >= receiver.length) fail('Array index is outside the array.');
      return receiver[index];
    }
  }
  const method = methods[key];
  if (!method) fail(`Property function member '${member}' is not allowed.`, 'MSB4185');
  return method(formatValue(receiver), args ?? []);
}

export const isStringMember = member => Object.hasOwn(methods, member.toLowerCase());
