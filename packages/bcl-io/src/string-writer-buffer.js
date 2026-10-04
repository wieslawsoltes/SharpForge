import {MAX, fail, integer} from '@sharpforge/bcl-core';
import {characterArray, characterSlice} from './character-buffer.js';
import {appendWriterBuilder, writerBuilderLength} from './string-writer-builder.js';

function bufferText(platform, data, index, count) {
  const block = new Uint16Array(Math.min(count, 4096));
  const parts = [];
  for (let offset = 0; offset < count; offset += block.length) {
    const length = Math.min(block.length, count - offset);
    for (let unit = 0; unit < length; unit++) {
      block[unit] = integer(platform, platform.native(data[index + offset + unit]), 0, 65535);
    }
    // Spread is bounded independently of caller count, preserving isolated UTF-16 surrogates.
    parts.push(String.fromCharCode(...block.subarray(0, length)));
  }
  return parts.join('');
}

/** One managed append per nonempty buffer; full-array null is a no-op even after disposal. */
export function writeStringBuffer(platform, reference, args, full) {
  const buffer = args[1];
  if (full && buffer === null) return null;
  const index = full ? 0 : platform.native(args[2]);
  const record = full ? characterArray(platform, buffer) : characterSlice(platform, buffer, index, platform.native(args[3]));
  const count = full ? record.data.length : platform.native(args[3]);
  if (platform.get(reference, '$disposed')) fail(platform, 'ObjectDisposedException', 'Cannot write to a closed TextWriter');
  if (count === 0) return null;
  const builder = platform.get(reference, '$builder');
  if (count > MAX - writerBuilderLength(platform, builder)) fail(platform, 'OutOfMemoryException', 'StringBuilder text limit');
  return platform.heap.withRoots([reference, buffer, builder], () => {
    appendWriterBuilder(platform, builder, bufferText(platform, record.data, index, count));
    return null;
  });
}
