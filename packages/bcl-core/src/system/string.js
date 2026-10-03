import {MAX, array, bclScalar, bounded, fail, integer, makeArray, string, text} from '../host.js';
import {compositeFormat} from '../formatting/composite-format.js';

const owner = 'System.String';

/** Register the released String members without changing their ABI order. */
export function registerString({define, member, prop}) {
  define(owner, {kind: 'bcl', family: 'string'});
  prop(owner, 'Empty', 'string', '', true, true);
  const methods = [
    ['IsNullOrEmpty', ['string'], 'bool', true],
    ['IsNullOrWhiteSpace', ['string'], 'bool', true],
    ['Concat', ['string', 'string'], 'string', true],
    ['Concat', ['string[]'], 'string', true],
    ['Join', ['string', 'string[]'], 'string', true],
    ['Join', ['string', 'int[]'], 'string', true],
    ['Equals', ['string', 'string'], 'bool', true],
    ['CompareOrdinal', ['string', 'string'], 'int', true],
    ['ToString', [], 'string', false],
    ['Substring', ['int'], 'string', false],
    ['Substring', ['int', 'int'], 'string', false],
    ['Contains', ['string'], 'bool', false],
    ['IndexOf', ['string'], 'int', false],
    ['IndexOf', ['string', 'int'], 'int', false],
    ['LastIndexOf', ['string'], 'int', false],
    ['StartsWith', ['string'], 'bool', false],
    ['EndsWith', ['string'], 'bool', false],
    ['Trim', [], 'string', false],
    ['TrimStart', [], 'string', false],
    ['TrimEnd', [], 'string', false],
    ['ToUpperInvariant', [], 'string', false],
    ['ToLowerInvariant', [], 'string', false],
    ['ToUpper', [], 'string', false],
    ['ToLower', [], 'string', false],
    ['Replace', ['string', 'string'], 'string', false],
    ['Split', ['string'], 'string[]', false],
    ['Split', ['string', 'int'], 'string[]', false],
    ['PadLeft', ['int'], 'string', false],
    ['PadRight', ['int'], 'string', false],
    ['Remove', ['int'], 'string', false],
    ['Remove', ['int', 'int'], 'string', false],
    ['Insert', ['int', 'string'], 'string', false]
  ];
  for (const [name, parameters, result, isStatic] of methods) member(owner, name, parameters, result, {isStatic});
  prop(owner, 'Length', 'int', 0, true);
  for (let count = 1; count <= 4; count++) {
    member(owner, 'Format', ['string', ...Array(count).fill('object')], 'string', {isStatic: true});
  }
  member(owner, 'Format', ['string', 'object[]'], 'string', {isStatic: true});
}

function splitString(platform, receiver, values, scalars) {
  const separator = string(platform, values[0], true);
  const limit = scalars.length === 2 ? integer(platform, scalars[1]) : MAX;
  let parts;
  if (!limit) parts = [];
  else if (limit === 1 || separator === '') parts = [receiver];
  else {
    parts = separator === null ? receiver.split(/\s/) : receiver.split(separator);
    if (parts.length > limit && separator !== null) {
      parts = [...parts.slice(0, limit - 1), parts.slice(limit - 1).join(separator)];
    } else if (parts.length > limit) {
      fail(platform, 'NotSupportedException', 'Whitespace Split with a bounded count is not supported');
    }
  }
  const references = [];
  return platform.heap.withRoots(references, () => {
    for (const value of parts) {
      const reference = platform.heap.string(value);
      references.push(reference);
      platform.heap.pins.push(reference);
    }
    return makeArray(platform, 'string', references);
  });
}

function staticString(platform, descriptor, values, scalars) {
  switch (descriptor.name) {
    case 'get_Empty': return '';
    case 'IsNullOrEmpty': return scalars[0] === null || scalars[0] === '';
    case 'IsNullOrWhiteSpace': return scalars[0] === null || /^\s*$/.test(scalars[0]);
    case 'Concat':
      return descriptor.parameters[0].endsWith('[]')
        ? array(platform, values[0]).map(value => text(platform, value)).join('')
        : scalars.map(value => value ?? '').join('');
    case 'Join': {
      const elementType = descriptor.parameters[1].slice(0, -2);
      return array(platform, values[1]).map(value => text(platform, value, elementType)).join(scalars[0] ?? '');
    }
    case 'Equals': return scalars[0] === scalars[1];
    case 'CompareOrdinal':
      if (scalars[0] === scalars[1]) return 0;
      if (scalars[0] === null) return -1;
      if (scalars[1] === null) return 1;
      return scalars[0] < scalars[1] ? -1 : 1;
    case 'Format': {
      const args = descriptor.parameters.at(-1) === 'object[]' ? array(platform, values[1]) : values.slice(1);
      return compositeFormat(platform, string(platform, values[0]), args);
    }
    default: fail(platform, 'MissingMethodException', descriptor.name);
  }
}

function instanceString(platform, name, receiver, values, scalars) {
  switch (name) {
    case 'get_Length': return receiver.length;
    case 'ToString': return receiver;
    case 'Substring': {
      const start = integer(platform, scalars[0], 0, receiver.length);
      const length = values.length === 1 ? receiver.length - start : integer(platform, scalars[1], 0, receiver.length - start);
      return receiver.slice(start, start + length);
    }
    case 'Contains': return receiver.includes(string(platform, values[0]));
    case 'StartsWith': return receiver.startsWith(string(platform, values[0]));
    case 'EndsWith': return receiver.endsWith(string(platform, values[0]));
    case 'IndexOf':
      return receiver.indexOf(string(platform, values[0]), values.length === 2 ? integer(platform, scalars[1], 0, receiver.length) : 0);
    case 'LastIndexOf': return receiver.lastIndexOf(string(platform, values[0]));
    case 'Trim': return receiver.trim();
    case 'TrimStart': return receiver.trimStart();
    case 'TrimEnd': return receiver.trimEnd();
    case 'ToUpper':
    case 'ToUpperInvariant': return receiver.toUpperCase();
    case 'ToLower':
    case 'ToLowerInvariant': return receiver.toLowerCase();
    case 'Replace': {
      const previous = string(platform, values[0]);
      if (!previous) fail(platform, 'ArgumentException', 'Old value cannot be empty');
      return receiver.split(previous).join(scalars[1] ?? '');
    }
    case 'PadLeft': return receiver.padStart(integer(platform, scalars[0]));
    case 'PadRight': return receiver.padEnd(integer(platform, scalars[0]));
    case 'Remove': {
      const start = integer(platform, scalars[0], 0, receiver.length);
      const length = scalars.length === 1 ? receiver.length - start : integer(platform, scalars[1], 0, receiver.length - start);
      return receiver.slice(0, start) + receiver.slice(start + length);
    }
    case 'Insert': {
      const start = integer(platform, scalars[0], 0, receiver.length);
      return receiver.slice(0, start) + string(platform, values[1]) + receiver.slice(start);
    }
    default: fail(platform, 'MissingMethodException', name);
  }
}

/** Invoke a registered String member; text allocations remain bounded and heap-owned. */
export function invokeString(platform, descriptor, args) {
  const reference = descriptor.isStatic || descriptor.kind === 'constructor' ? null : args[0];
  const values = reference === null ? args : args.slice(1);
  const scalars = values.map(value => bclScalar(platform, value));
  let output;
  if (descriptor.isStatic) output = staticString(platform, descriptor, values, scalars);
  else {
    if (reference === null) fail(platform, 'NullReferenceException', 'String receiver is null');
    const receiver = string(platform, reference);
    if (descriptor.name === 'Split') return {handled: true, value: splitString(platform, receiver, values, scalars)};
    output = instanceString(platform, descriptor.name, receiver, values, scalars);
  }
  const value = platform.managed(typeof output === 'string' ? bounded(platform, output) : output, descriptor.result);
  return {handled: true, value};
}

export const stringModule = Object.freeze({
  name: 'string',
  families: Object.freeze(['string']),
  contracts: registerString,
  invoke: invokeString
});
