import {fail, integer, string} from '@sharpforge/bcl-core';

function validateSlice(platform, buffer, index, count) {
  if (buffer === null) fail(platform, 'ArgumentNullException', 'A character buffer is required');
  if (!platform.bclHost.isReference(buffer)) fail(platform, 'ArgumentException', 'A character array is required');
  const record = platform.heap.get(buffer);
  if (record.kind !== 'array' || record.methodTable.rank !== 1 || !record.methodTable.flags.szArray ||
      record.methodTable.elementType !== platform.heap.methodTables.get('char')) {
    fail(platform, 'ArgumentException', 'A one-dimensional character array is required');
  }
  integer(platform, index, 0, 2147483647);
  integer(platform, count, 0, 2147483647);
  // Subtraction avoids overflowing the Int32 index/count boundary used by the managed API.
  if (record.data.length - index < count) fail(platform, 'ArgumentException', 'The buffer slice is outside the array');
  return record;
}

/** Copy up to count UTF-16 units in O(units read), with no managed allocation or replacement storage. */
export function readStringBuffer(platform, reference, args) {
  const buffer = args[1];
  const index = platform.native(args[2]);
  const count = platform.native(args[3]);
  const record = validateSlice(platform, buffer, index, count);
  // StringReader validates the slice before disposal, including zero-length reads and ReadBlock.
  if (platform.get(reference, '$disposed')) fail(platform, 'ObjectDisposedException', 'Cannot read from a closed TextReader');
  const input = platform.get(reference, '$source');
  const source = string(platform, input);
  const position = platform.get(reference, '$position');
  const length = Math.min(count, source.length - position);
  if (length === 0) return 0;
  return platform.heap.withRoots([reference, buffer, input], () => {
    for (let offset = 0; offset < length; offset++) {
      const target = index + offset;
      const oldValue = record.data[target];
      const value = platform.managed(source.charCodeAt(position + offset), 'char');
      record.data[target] = value;
      platform.heap.mutationRevision++;
      platform.vm.notifyWrite?.({kind: 'array', handle: buffer.h, generation: buffer.g, index: target, oldValue, value});
    }
    platform.set(reference, '$position', position + length);
    return length;
  });
}
