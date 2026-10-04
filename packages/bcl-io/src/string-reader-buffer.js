import {fail, string} from '@sharpforge/bcl-core';
import {characterSlice} from './character-buffer.js';

/** Copy up to count UTF-16 units in O(units read), with no managed allocation or replacement storage. */
export function readStringBuffer(platform, reference, args) {
  const buffer = args[1];
  const index = platform.native(args[2]);
  const count = platform.native(args[3]);
  const record = characterSlice(platform, buffer, index, count);
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
