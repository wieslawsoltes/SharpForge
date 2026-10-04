import { frameworkType } from '@sharpforge/framework';
import { CilError } from '../binary.js';
import { signaturePrimitives, signaturePrimitiveNodes, signatureAliases, signatureBudget } from './signature-types.js';

const collections = new Set(['List', 'Dictionary', 'HashSet', 'Queue', 'Stack', 'IEnumerable', 'IList', 'ICollection']);
const genericValues = new Set([
  'System.Nullable', 'System.ValueTuple', 'System.Collections.Generic.KeyValuePair', 'System.Numerics.Vector',
  'System.Memory', 'System.ReadOnlyMemory', 'System.Span', 'System.ReadOnlySpan', 'System.ArraySegment',
  'System.Threading.Tasks.ValueTask',
]);

function parts(text) {
  const result = [];
  const stack = [];
  let start = 0;
  const pairs = { '>': '<', ']': '[', ')': '(' };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if ('<[('.includes(character)) stack.push(character);
    else if (Object.hasOwn(pairs, character) && stack.pop() !== pairs[character]) throw new CilError('Unbalanced signature type');
    else if (character === ',' && !stack.length) {
      result.push(text.slice(start, index).trim());
      start = index + 1;
    }
    if (stack.length > 64) throw new CilError('Signature complexity limit exceeded');
  }
  if (stack.length) throw new CilError('Unbalanced signature type');
  result.push(text.slice(start).trim());
  return result;
}

function opening(text, close, open) {
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    if (text[index] === close) depth++;
    else if (text[index] === open && --depth === 0) return index;
  }
  throw new CilError('Unbalanced signature type');
}

function arrayShape(text, element) {
  if (text === '') return { kind: 'szarray', element };
  const dimensions = parts(text);
  if (dimensions.length > 32) throw new CilError('Array rank limit exceeded');
  const sizes = [];
  const lowerBounds = [];
  let boundsEnded = false;
  let sizesEnded = false;
  for (const dimension of dimensions) {
    const match = /^(-?\d+)\.\.\.(-?\d+)?$/.exec(dimension);
    if (!match && dimension !== '' && dimension !== '*') throw new CilError('Invalid array dimension');
    if (match) {
      if (boundsEnded) throw new CilError('Array lower bounds must form a prefix');
      const bound = Number(match[1]);
      lowerBounds.push(bound);
      if (match[2] !== undefined) {
        if (sizesEnded) throw new CilError('Array sizes must form a prefix');
        const size = Number(match[2]) - bound + 1;
        if (!Number.isSafeInteger(size) || size < 0) throw new CilError('Invalid array size');
        sizes.push(size);
      } else sizesEnded = true;
    } else {
      boundsEnded = true;
      sizesEnded = true;
    }
  }
  return { kind: 'array', element, rank: dimensions.length, sizes, lowerBounds };
}

function genericName(name, arity) {
  const bare = name.replace(/`\d+$/, '');
  if (collections.has(bare)) name = 'System.Collections.Generic.' + name;
  else if (['Action', 'Func', 'Nullable', 'ValueTuple'].includes(bare)) name = 'System.' + name;
  else if (bare === 'Task') name = 'System.Threading.Tasks.' + name;
  else if (bare === 'Vector') name = 'System.Numerics.' + name;
  return /`\d+$/.test(name) ? name : name + '`' + arity;
}

/** Parse compatibility string types once, without splitting commas inside nested types. */
export function parseSignatureType(value, resolveToken, options = {}) {
  const budget = signatureBudget(options);
  function named(name, kind) {
    if (typeof resolveToken !== 'function') throw new CilError('Type token resolver is required');
    const token = resolveToken(name);
    const base = name.replace(/`\d+$/, '');
    const isValue = token >>> 24 !== 2 &&
      ((/`\d+$/.test(name) && genericValues.has(base)) || ['enum', 'value'].includes(frameworkType(name)?.kind));
    return { kind: kind ?? (isValue ? 'valuetype' : 'class'), token };
  }
  function parse(text, depth = 0) {
    budget(depth);
    if (typeof text !== 'string' || !text.trim() || text.length > 65536) throw new CilError('Invalid signature type name');
    text = text.trim();
    const declared = options.namedTypes?.get(text);
    if (declared) return declared;
    if (text.endsWith(' pinned')) return { kind: 'pinned', element: parse(text.slice(0, -7), depth + 1) };
    if (text.endsWith(')')) {
      const start = opening(text, ')', '(');
      const prefix = text.slice(0, start);
      const modifier = / (modreq|modopt)$/.exec(prefix);
      if (modifier) return {
        kind: modifier[1], token: named(text.slice(start + 1, -1)).token,
        element: parse(prefix.slice(0, modifier.index), depth + 1),
      };
    }
    if (text.endsWith('&') || text.endsWith('*')) return {
      kind: text.endsWith('&') ? 'byref' : 'pointer', element: parse(text.slice(0, -1), depth + 1),
    };
    if (text.endsWith('?')) return {
      kind: 'genericInstance', type: named('System.Nullable`1', 'valuetype'),
      arguments: [parse(text.slice(0, -1), depth + 1)],
    };
    if (text.endsWith(']')) {
      const start = opening(text, ']', '[');
      return arrayShape(text.slice(start + 1, -1), parse(text.slice(0, start), depth + 1));
    }
    const parameter = /^(!{1,2})(\d+)$/.exec(text);
    if (parameter) return { kind: 'genericParameter', scope: parameter[1] === '!' ? 'type' : 'method', index: +parameter[2] };
    let kind;
    if (/^(class|valuetype) /.test(text)) {
      const split = text.indexOf(' ');
      kind = text.slice(0, split);
      text = text.slice(split + 1).trim();
    }
    if (text.endsWith('>')) {
      const start = opening(text, '>', '<');
      const args = parts(text.slice(start + 1, -1));
      if (args.some(argument => !argument)) throw new CilError('Generic instance requires nonempty arguments');
      return {
        kind: 'genericInstance', type: named(genericName(text.slice(0, start).trim(), args.length), kind),
        arguments: args.map(argument => parse(argument, depth + 1)),
      };
    }
    const alias = Object.hasOwn(signatureAliases, text) ? signatureAliases[text] : text;
    if (!kind && Object.hasOwn(signaturePrimitives, alias)) return signaturePrimitiveNodes[alias];
    // Compiler-generated names such as <>AllocationToken and <Run>d__1 are atomic identifiers.
    const identifier = text.replace(/(^|[.+])<[^<>]*>(?=[\w])/g, '$1Generated');
    if (/[<>\[\](),&*\s]/.test(identifier)) throw new CilError('Invalid signature type name');
    // The caller resolves owned TypeDefs before applying aliases to external references.
    return named(text, kind);
  }
  return typeof value === 'object' && value !== null ? value : parse(value);
}
