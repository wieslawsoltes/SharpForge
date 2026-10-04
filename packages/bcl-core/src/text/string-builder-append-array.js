import {MAX, fail, integer} from '../host.js';

const owner = 'System.Text.StringBuilder';

/** Append native array signatures after the string-range overload without moving earlier contracts. */
export function registerStringBuilderArrayExtensions({member}) {
  member(owner, 'Append', ['char[]'], owner);
  member(owner, 'Append', ['char[]', 'int', 'int'], owner);
}

function nonnegativeIndex(platform, value, parameter) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
    fail(platform, 'ArgumentOutOfRangeException', "Value is outside the supported range. (Parameter '" + parameter + "')");
  }
  return value;
}

function characterArray(platform, value) {
  if (!platform.bclHost.isReference(value)) fail(platform, 'ArgumentException', 'A character array is required');
  const record = platform.heap.get(value);
  if (record.kind !== 'array' || record.methodTable.rank !== 1 || !record.methodTable.flags.szArray ||
      record.methodTable.elementType !== platform.heap.methodTables.get('char')) {
    fail(platform, 'ArgumentException', 'A one-dimensional character array is required');
  }
  return record.data;
}

function selectedText(platform, data, start, count) {
  const block = new Uint16Array(Math.min(count, 4096));
  const parts = [];
  for (let offset = 0; offset < count; offset += block.length) {
    const length = Math.min(block.length, count - offset);
    for (let index = 0; index < length; index++) {
      block[index] = integer(platform, platform.native(data[start + offset + index]), 0, 65535);
    }
    // Limit spread independently of the input size, retaining every raw UTF-16 unit.
    parts.push(String.fromCharCode(...block.subarray(0, length)));
  }
  return parts.join('');
}

/** Validate before host conversion, then reuse one existing managed chunk append; null/empty successes never write. */
export function appendBuilderArray(platform, reference, values, scalars, appendText) {
  const full = values.length === 1;
  const start = full ? 0 : nonnegativeIndex(platform, scalars[1], 'startIndex');
  let count = full ? 0 : nonnegativeIndex(platform, scalars[2], 'charCount');
  if (values[0] === null) {
    if (start !== 0 || count !== 0) fail(platform, 'ArgumentNullException', "A character array is required. (Parameter 'value')");
    return reference;
  }
  const data = characterArray(platform, values[0]);
  if (full) count = data.length;
  // Unlike the string overload, the array overload checks the upper bound even when charCount is zero.
  if (start > data.length - count) {
    fail(platform, 'ArgumentOutOfRangeException', "Range exceeds the character array. (Parameter 'charCount')");
  }
  if (count === 0) return reference;
  if (count > MAX - platform.get(reference, '$length', 0)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  return appendText(platform, reference, selectedText(platform, data, start, count));
}
