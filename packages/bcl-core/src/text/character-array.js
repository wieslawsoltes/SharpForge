import {fail, integer} from '../host.js';

/** Require a managed one-dimensional Char array and return its live UTF-16 element storage. */
export function characterArray(platform, value) {
  if (!platform.bclHost.isReference(value)) fail(platform, 'ArgumentException', 'A character array is required');
  const record = platform.heap.get(value);
  if (record.kind !== 'array' || record.methodTable.rank !== 1 || !record.methodTable.flags.szArray ||
      record.methodTable.elementType !== platform.heap.methodTables.get('char')) {
    fail(platform, 'ArgumentException', 'A one-dimensional character array is required');
  }
  return record.data;
}

/** Copy a validated Char-array range into host text using bounded blocks and literal UTF-16 code units. */
export function characterArrayText(platform, data, start, count) {
  const block = new Uint16Array(Math.min(count, 4096));
  const parts = [];
  for (let offset = 0; offset < count; offset += block.length) {
    const length = Math.min(block.length, count - offset);
    for (let index = 0; index < length; index++) {
      block[index] = integer(platform, platform.native(data[start + offset + index]), 0, 65535);
    }
    // Limit spread independently of input size; String.fromCharCode preserves isolated surrogates.
    parts.push(String.fromCharCode(...block.subarray(0, length)));
  }
  return parts.join('');
}
