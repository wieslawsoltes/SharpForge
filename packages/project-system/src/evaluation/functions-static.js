import { fail, number, formatValue, toBoolean } from './errors.js';
import { invokeStringMember } from './functions-string.js';

const fileName = value => String(value).replaceAll('\\', '/').split('/').at(-1);
const extension = value => {
  const name = fileName(value);
  const at = name.lastIndexOf('.');
  return at < 0 ? '' : name.slice(at);
};

function stringFormat(args) {
  const [pattern, ...values] = args;
  return String(pattern).replace(/{{|}}|\{(\d+)(?:,(-?\d+))?(?::([^}]+))?\}/g, (token, index, width, specifier) => {
    if (token === '{{' || token === '}}') return token[0];
    if (Number(index) >= values.length) fail('String.Format argument index is outside the argument list.');
    if (specifier) fail(`String.Format format '${specifier}' is not in the portable allow-list.`);
    const value = formatValue(values[Number(index)]);
    return width ? Number(width) < 0 ? value.padEnd(-Number(width)) : value.padStart(Number(width)) : value;
  });
}

function version(value) {
  if (!/^\d+\.\d+(?:\.\d+){0,2}$/.test(String(value))) fail(`'${value}' is not a System.Version.`);
  const parts = String(value).split('.').map(value => number(value, true));
  if (parts.some(part => part > 2147483647)) fail('System.Version component exceeds Int32.');
  return { kind: 'version', value: parts.join('.'), parts };
}

function round(value, digits = 0, mode = 'ToEven') {
  digits = number(digits, true);
  if (digits < 0 || digits > 15) fail('Math.Round digits must be in [0, 15].');
  const scale = 10 ** digits;
  const input = number(value) * scale;
  const sign = Math.sign(input);
  const absolute = Math.abs(input);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  mode = String(mode).replace(/^System\.MidpointRounding\./, '');
  if (!['ToEven', 'AwayFromZero', 'ToZero', 'ToNegativeInfinity', 'ToPositiveInfinity'].includes(mode)) fail('Unknown rounding mode.');
  if (mode === 'ToZero') return Math.trunc(input) / scale;
  if (mode === 'ToNegativeInfinity') return Math.floor(input) / scale;
  if (mode === 'ToPositiveInfinity') return Math.ceil(input) / scale;
  const rounded = fraction === 0.5 && mode === 'ToEven' ? whole + whole % 2 : Math.floor(absolute + 0.5);
  return sign * rounded / scale;
}

function regex(args) {
  const input = String(args[0]);
  const pattern = String(args[1]);
  if (input.length > 65536 || pattern.length > 256) fail('Regex input or pattern limit exceeded.');
  // Native JS has no cancellable matching. Reject backtracking constructs whose work cannot be bounded here.
  if (/\\[1-9]|\(\?|\)[*+?{]|(?:[*+?]|\{[^}]+\})\s*(?:[*+?]|\{)/.test(pattern)) {
    fail('Regex backreferences, special groups and quantified groups require the native engine.', 'MSB4185');
  }
  const options = String(args[2] ?? '');
  if (options && !/^(?:System\.Text\.RegularExpressions\.RegexOptions\.)?(?:None|IgnoreCase|Multiline|Singleline|CultureInvariant|\d+)$/.test(options)) {
    fail('Regex options are outside the portable allow-list.');
  }
  const flags = 'g' + (/IgnoreCase/.test(options) || Number(options) & 1 ? 'i' : '')
    + (/Multiline/.test(options) || Number(options) & 2 ? 'm' : '')
    + (/Singleline/.test(options) || Number(options) & 16 ? 's' : '');
  try { return { input, expression: new RegExp(pattern, flags) }; }
  catch (error) { fail(`Invalid regular expression: ${error.message}`); }
}

function stringConstructor(args) {
  if (args.length === 1) return Array.isArray(args[0]) ? args[0].join('') : String(args[0] ?? '');
  if (args.length !== 2 || String(args[0]).length !== 1) fail('String construction requires a character and a bounded count.');
  const count = number(args[1], true);
  if (count < 0 || count > 65536) fail('String construction count exceeds its allowed range.');
  return String(args[0]).repeat(count);
}

const stringFunctions = {
  copy: args => String(args[0] ?? ''),
  new: stringConstructor,
  concat: args => args.map(formatValue).join(''),
  join: args => (args.length === 2 && Array.isArray(args[1]) ? args[1] : args.slice(1)).map(formatValue).join(String(args[0])),
  isempty: args => !String(args[0] ?? ''),
  isnullorempty: args => !String(args[0] ?? ''),
  isnullorwhitespace: args => !String(args[0] ?? '').trim(),
  equals: args => invokeStringMember(args[0], 'Equals', args.slice(1)),
  format: stringFormat,
};

const pathFunctions = {
  combine(args) {
    let value = '';
    for (const part of args.flat()) {
      const segment = String(part).replaceAll('\\', '/');
      value = segment.startsWith('/') ? segment : value && segment ? value.replace(/\/$/, '') + '/' + segment : value || segment;
    }
    return value;
  },
  getfilename: args => fileName(args[0]),
  getfilenamewithoutextension: args => fileName(args[0]).slice(0, extension(args[0]) ? -extension(args[0]).length : undefined),
  getdirectoryname(args) {
    const path = String(args[0]).replaceAll('\\', '/').replace(/\/+$/, '');
    return path.slice(0, Math.max(0, path.lastIndexOf('/')));
  },
  getextension: args => extension(args[0]),
  hasextension: args => Boolean(extension(args[0])),
  changeextension(args) {
    const path = String(args[0]);
    return path.slice(0, extension(path) ? -extension(path).length : undefined)
      + (args[1] === null ? '' : String(args[1]).startsWith('.') ? args[1] : '.' + args[1]);
  },
  getfullpath: (args, context) => '/' + context.resolvePath(String(args[0]), args[1] ? context.resolvePath(String(args[1])) : context.base),
  ispathrooted: args => /^(\/|\\|[A-Za-z]:)/.test(String(args[0])),
  getpathroot: args => /^[/\\]/.test(String(args[0])) ? '/' : '',
  directoryseparatorchar: () => '/',
  altdirectoryseparatorchar: () => '/',
  pathseparator: () => ':',
};

const mathFunctions = Object.fromEntries([
  'abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'cos', 'cosh', 'exp', 'floor', 'log', 'log10', 'max', 'min', 'pow',
  'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc',
].map(name => [name, args => Math[name](...args.map(value => number(value)))]));
Object.assign(mathFunctions, { ceiling: mathFunctions.ceil, truncate: mathFunctions.trunc, round: args => round(...args), pi: () => Math.PI, e: () => Math.E });

function convertInteger(args, bits, signed) {
  const value = args.length === 2 ? parseInt(String(args[0]), number(args[1], true)) : number(args[0]);
  const rounded = round(value);
  const min = signed ? -(2 ** (bits - 1)) : 0;
  const max = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
  if (!Number.isSafeInteger(rounded) || rounded < min || rounded > max) fail('Integer conversion overflow.');
  return rounded;
}

const convertFunctions = {
  tostring: args => args.length === 2 ? number(args[0], true).toString(number(args[1], true)) : formatValue(args[0]),
  toboolean: args => toBoolean(args[0]),
  toint16: args => convertInteger(args, 16, true),
  toint32: args => convertInteger(args, 32, true),
  toint64: args => convertInteger(args, 53, true),
  touint16: args => convertInteger(args, 16, false),
  touint32: args => convertInteger(args, 32, false),
  tobyte: args => convertInteger(args, 8, false),
  todouble: args => number(args[0]),
  tosingle: args => Math.fround(number(args[0])),
  tochar: args => typeof args[0] === 'number' ? String.fromCharCode(convertInteger(args, 16, false)) : String(args[0]),
};

function date(args) {
  const value = new Date(String(args[0]));
  if (!Number.isFinite(value.getTime())) fail('Invalid DateTime value.');
  return value;
}

const registry = {
  'system.string': stringFunctions,
  'system.io.path': pathFunctions,
  'system.math': mathFunctions,
  'system.version': { parse: args => version(args[0]), new: args => version(args.length === 1 ? args[0] : args.join('.')) },
  'system.convert': convertFunctions,
  'system.char': {
    isdigit: args => /^\p{Nd}$/u.test(String(args[0])),
    isletter: args => /^\p{L}$/u.test(String(args[0])),
    isletterordigit: args => /^[\p{L}\p{Nd}]$/u.test(String(args[0])),
    iswhitespace: args => /^\s$/u.test(String(args[0])),
    toupperinvariant: args => String(args[0]).toUpperCase(),
    tolowerinvariant: args => String(args[0]).toLowerCase(),
    parse: args => String(args[0]).length === 1 ? String(args[0]) : fail('Char.Parse requires one UTF-16 character.'),
  },
  'system.guid': {
    empty: () => '00000000-0000-0000-0000-000000000000',
    parse: args => /^[{(]?[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}[})]?$/i.test(String(args[0]))
      ? String(args[0]).replace(/[{}()]/g, '').toLowerCase() : fail('Invalid Guid.'),
    newguid: (args, context) => context.guid ? context.guid() : fail('Guid.NewGuid requires an explicit deterministic GUID provider.'),
  },
  'system.datetime': {
    parse: date,
    utcnow: (args, context) => context.clock ? new Date(context.clock()) : fail('DateTime.UtcNow requires an explicit clock.'),
    now: (args, context) => context.clock ? new Date(context.clock()) : fail('DateTime.Now requires an explicit clock.'),
    minvalue: () => new Date('0001-01-01T00:00:00.000Z'),
  },
  'system.environment': {
    getenvironmentvariable: (args, context) => context.environment?.[String(args[0])] ?? '',
    newline: (args, context) => context.newline ?? '\n',
    currentdirectory: (args, context) => '/' + context.base,
    osversion: (args, context) => context.osVersion ?? 'Unix',
  },
  'system.text.regularexpressions.regex': {
    ismatch(args) { const { input, expression } = regex(args); return expression.test(input); },
    replace(args) { const { input, expression } = regex([args[0], args[1], args[3]]); return input.replace(expression, String(args[2])); },
    split(args) { const { input, expression } = regex(args); return input.split(expression); },
    escape: args => String(args[0]).replace(/[.*+?^${}()|[\]\\\s#]/g, '\\$&'),
  },
};

/** Static calls are resolved solely through this allow-list; no reflection or host access is performed. */
export function invokeStaticFunction(type, member, args, context) {
  const handler = registry[type.toLowerCase()]?.[member.toLowerCase()];
  if (!handler) fail(`Static property function '${type}::${member}' is not allowed.`, 'MSB4185');
  const result = handler(args ?? [], context);
  if (typeof result === 'string' && result.length > 65536) fail('Property function result limit exceeded.');
  return result;
}

export function invokeTypedMember(receiver, member, args = []) {
  if (receiver?.kind === 'version') {
    const index = ['major', 'minor', 'build', 'revision'].indexOf(member.toLowerCase());
    if (index >= 0) return receiver.parts[index] ?? -1;
    if (member.toLowerCase() === 'tostring') return args.length ? receiver.parts.slice(0, number(args[0], true)).join('.') : receiver.value;
  }
  if (receiver instanceof Date) {
    const name = member.toLowerCase();
    const getters = { year: 'getUTCFullYear', month: 'getUTCMonth', day: 'getUTCDate', hour: 'getUTCHours', minute: 'getUTCMinutes' };
    if (getters[name]) return receiver[getters[name]]() + (name === 'month' ? 1 : 0);
    if (name === 'tostring') {
      const iso = receiver.toISOString();
      if (!args.length || ['o', 'O', 's'].includes(args[0])) return args[0] === 's' ? iso.slice(0, 19) : iso;
      if (args[0] === 'yyyy-MM-dd') return iso.slice(0, 10);
      fail(`DateTime format '${args[0]}' requires the native engine.`);
    }
  }
  return invokeStringMember(receiver, member, args);
}
