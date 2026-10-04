import {fail, integer} from '@sharpforge/bcl-core';

/** Require the actual managed SZ char[] shape, without allocating or changing its storage. */
export function characterArray(platform, buffer) {
  if (buffer === null) fail(platform, 'ArgumentNullException', 'A character buffer is required');
  if (!platform.bclHost.isReference(buffer)) fail(platform, 'ArgumentException', 'A character array is required');
  const record = platform.heap.get(buffer);
  if (record.kind !== 'array' || record.methodTable.rank !== 1 || !record.methodTable.flags.szArray ||
      record.methodTable.elementType !== platform.heap.methodTables.get('char')) {
    fail(platform, 'ArgumentException', 'A one-dimensional character array is required');
  }
  return record;
}

/** Shared reader/writer precedence: buffer, index, count, then overflow-safe slice bounds. */
export function characterSlice(platform, buffer, index, count) {
  const record = characterArray(platform, buffer);
  integer(platform, index, 0, 2147483647);
  integer(platform, count, 0, 2147483647);
  if (record.data.length - index < count) fail(platform, 'ArgumentException', 'The buffer slice is outside the array');
  return record;
}
