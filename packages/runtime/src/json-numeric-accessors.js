import {ManagedFault} from './heap.js';

function invalidInteger(type) {
  throw new ManagedFault('FormatException', `JSON number cannot be represented as ${type}`);
}

function integerText(data, node, type, maximumLength) {
  // Reject oversized tokens before slicing or constructing a potentially huge BigInt.
  if (node.end - node.start > maximumLength) invalidInteger(type);
  const text = data.text.slice(node.start, node.end);
  if (!/^-?\d+$/.test(text)) invalidInteger(type);
  return text;
}

function int32(data, node) {
  integerText(data, node, 'Int32', 11);
  if (!Number.isInteger(node.value) || node.value < -2147483648 || node.value > 2147483647) {
    invalidInteger('Int32');
  }
  return node.value;
}

function int64(data, node) {
  const value = BigInt(integerText(data, node, 'Int64', 20));
  if (value < -9223372036854775808n || value > 9223372036854775807n) invalidInteger('Int64');
  return value;
}

const readers = Object.freeze({GetInt32: int32, GetInt64: int64, GetDouble: (data, node) => node.value});

/** Read JSON numbers from retained spans; Int64 never passes through the approximate Number value. */
export function invokeJsonNumber(platform, descriptor, data, node) {
  if (!Object.hasOwn(readers, descriptor.name)) return null;
  if (node.kind !== 4) throw new ManagedFault('InvalidOperationException', 'Unexpected JSON value kind');
  return {handled: true, value: platform.managed(readers[descriptor.name](data, node), descriptor.result)};
}
