import {canonicalType} from '@sharpforge/framework';
import {exceptionTypeName} from './exception-types.js';

const aliases = {
  object: 'System.Object', string: 'System.String', bool: 'System.Boolean', char: 'System.Char',
  sbyte: 'System.SByte', byte: 'System.Byte', short: 'System.Int16', ushort: 'System.UInt16',
  int: 'System.Int32', uint: 'System.UInt32', long: 'System.Int64', ulong: 'System.UInt64',
  float: 'System.Single', double: 'System.Double', decimal: 'System.Decimal',
  nint: 'System.IntPtr', nuint: 'System.UIntPtr', void: 'System.Void'
};
const genericPrefix = 'System.Collections.Generic.';
const genericNames = new Set(['IEnumerable', 'IEnumerator', 'ICollection', 'IList', 'IReadOnlyCollection',
  'IReadOnlyList', 'IComparer', 'IEqualityComparer', 'List', 'Dictionary', 'HashSet', 'Queue', 'Stack']);

/** Split a type argument list, preserving registered assembly identities as opaque tokens. */
export function splitTypeArguments(text, registered = null) {
  const result = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const knownEnd = registered?.match(text, index) ?? -1;
    if (knownEnd !== -1) {
      index = knownEnd - 1;
      continue;
    }
    if (text[index] === '<' || text[index] === '[') depth++;
    else if (text[index] === '>' || text[index] === ']') depth--;
    else if (text[index] === ',' && depth === 0) {
      result.push(text.slice(start, index).trim());
      start = index + 1;
    }
    if (depth < 0) throw new TypeError('Unbalanced runtime type name');
  }
  if (depth !== 0) throw new TypeError('Unbalanced runtime type name');
  result.push(text.slice(start).trim());
  return result;
}

/** Canonicalize supported runtime type syntax; registered identities are never parsed or rewritten. */
export function runtimeTypeName(input, registered = null) {
  if (typeof input !== 'string' || !input.trim()) throw new TypeError('A runtime type name is required');
  const name = input.trim();
  if (registered?.has(name)) return name;
  const array = /^(.*)\[([^\[\]]*)\]$/.exec(name);
  if (array) {
    const shape = array[2];
    const dimensions = shape.split(',');
    if (shape !== '' && shape !== '*' && !dimensions.every(value => value === '' || /^-?\d+\.\.\.-?\d*$/.test(value))) {
      throw new TypeError('Invalid runtime array shape');
    }
    if (dimensions.length > 32) throw new TypeError('Runtime array rank exceeds 32');
    const suffix = shape === '' ? '[]' : dimensions.length === 1 ? '[*]' : '[' + ','.repeat(dimensions.length - 1) + ']';
    return runtimeTypeName(array[1], registered) + suffix;
  }
  if (name.endsWith('?')) return 'System.Nullable`1<' + runtimeTypeName(name.slice(0, -1), registered) + '>';
  if (name.endsWith('&') || name.endsWith('*')) return runtimeTypeName(name.slice(0, -1), registered) + name.at(-1);
  const knownEnd = registered?.match(name, 0) ?? -1;
  const angle = name.indexOf('<', knownEnd === -1 ? 0 : knownEnd);
  if (angle >= 0) {
    if (!name.endsWith('>')) throw new TypeError('Unbalanced runtime type name');
    const arguments_ = splitTypeArguments(name.slice(angle + 1, -1), registered);
    let definition = name.slice(0, angle).trim();
    if (!/`\d+$/.test(definition)) {
      const short = definition.replace(/^System\.Collections\.Generic\./, '');
      definition += '`' + (genericNames.has(short) ? short === 'Dictionary' ? 2 : 1 : arguments_.length);
    }
    const parameters = arguments_.map(argument => argument ? runtimeTypeName(argument, registered) : '');
    return runtimeTypeName(definition, registered) + '<' + parameters.join(', ') + '>';
  }
  const stem = name.replace(/`\d+$/, '');
  if (/[<>\[\]]/.test(name)) throw new TypeError('Unbalanced runtime type name');
  if (genericNames.has(stem)) return genericPrefix + name;
  if (/^(Nullable|Action|Func|IComparable|IEquatable)`\d+$/.test(name)) return 'System.' + name;
  return aliases[name] ?? exceptionTypeName(canonicalType(name));
}
