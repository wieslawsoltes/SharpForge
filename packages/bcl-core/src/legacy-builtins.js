import {invokeLegacyStringMember} from './system/string.js';
import {objectToString} from './system/object-string.js';

function parseInt32Value(host, input) {
  if (input === null) throw host.fault('ArgumentNullException', 'String cannot be null');
  const text = String(input).trim();
  if (!/^[+-]?\d+$/.test(text)) {
    throw host.fault('FormatException', 'Input string was not in a correct format');
  }
  const value = Number(text);
  if (value < -2147483648 || value > 2147483647) {
    throw host.fault('OverflowException', 'Value is outside the Int32 range');
  }
  return value | 0;
}

function parseInt32(host, args) {
  return parseInt32Value(host, host.value(args[0]));
}

function parseDouble(host, args) {
  const text = String(host.value(args[0]) ?? '').trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) {
    throw host.fault('FormatException', 'Invalid floating-point input');
  }
  return Number(text);
}

function convertInt32(host, args) {
  const input = host.value(args[0]);
  if (input === null) return 0;
  if (typeof input === 'string') return parseInt32Value(host, input);
  const value = Number(input);
  const floor = Math.floor(value);
  const fraction = value - floor;
  const rounded = fraction === 0.5 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(value);
  if (!Number.isFinite(rounded) || rounded < -2147483648 || rounded > 2147483647) {
    throw host.fault('OverflowException', 'Value is outside the Int32 range');
  }
  return rounded | 0;
}

function convertDouble(host, args) {
  const value = Number(host.value(args[0]));
  if (Number.isNaN(value)) throw host.fault('FormatException', 'Cannot convert value to double');
  return value;
}

function convertString(host, args) {
  return host.heap.string(host.runtimeTypeText(args[0]) ?? host.format(args[0]));
}

const stringDescriptors = Object.freeze(Object.fromEntries([
  ['Concat', ['string', 'string'], 'string', true],
  ['IsNullOrEmpty', ['string'], 'bool', true],
  ['Substring', ['int'], 'string', false],
  ['Contains', ['string'], 'bool', false],
  ['IndexOf', ['string'], 'int', false],
  ['StartsWith', ['string'], 'bool', false],
  ['EndsWith', ['string'], 'bool', false],
  ['ToUpper', [], 'string', false],
  ['ToLower', [], 'string', false],
  ['Trim', [], 'string', false],
  ['Replace', ['string', 'string'], 'string', false]
].map(([name, parameters, result, isStatic]) => ['string.' + name, Object.freeze({
  owner: 'System.String', name, parameters: Object.freeze(parameters), result, isStatic, kind: 'method'
})])));

const substringRangeDescriptor = Object.freeze({
  ...stringDescriptors['string.Substring'], parameters: Object.freeze(['int', 'int'])
});

function invokeLegacyString(host, args, name) {
  const descriptor = name === 'string.Substring' && args.length === 3
    ? substringRangeDescriptor : stringDescriptors[name];
  // Legacy CIL also accepts Concat(object, object); retain managed object formatting.
  const values = name === 'string.Concat' ? args.map(value => host.format(value)) : args;
  return invokeLegacyStringMember(host.platform, descriptor, values).value;
}

const handlers = Object.freeze({
  'int.Parse': parseInt32,
  'double.Parse': parseDouble,
  'Convert.ToInt32': convertInt32,
  'Convert.ToDouble': convertDouble,
  'Convert.ToString': convertString,
  'object.ToString': objectToString,
  'string.Concat': invokeLegacyString,
  'string.IsNullOrEmpty': invokeLegacyString,
  'string.Substring': invokeLegacyString,
  'string.Contains': invokeLegacyString,
  'string.IndexOf': invokeLegacyString,
  'string.StartsWith': invokeLegacyString,
  'string.EndsWith': invokeLegacyString,
  'string.ToUpper': invokeLegacyString,
  'string.ToLower': invokeLegacyString,
  'string.Trim': invokeLegacyString,
  'string.Replace': invokeLegacyString
});

/** Released primitive intrinsic names; extending this list does not change bytecode IDs. */
export const legacyBclBuiltinNames = Object.freeze(Object.keys(handlers));

/** Return whether this package owns a released parse, conversion or string intrinsic. */
export function hasLegacyBclBuiltin(name) {
  return Object.hasOwn(handlers, name);
}

/**
 * Invoke released BCL semantics using explicit platform, heap, value, formatting and fault services.
 * The caller roots managed arguments and converts numeric results to its engine's representation.
 * Invalid input throws host.fault(type, message); unknown names throw MissingMethodException.
 */
export function invokeLegacyBclBuiltin(host, name, args) {
  if (!hasLegacyBclBuiltin(name)) {
    throw host.fault('MissingMethodException', `Intrinsic '${name}' is not implemented`);
  }
  return handlers[name](host, args, name);
}
