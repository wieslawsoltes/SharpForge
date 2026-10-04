import {MAX, fail, string} from '../host.js';
import {nonnegativeIndex} from './string-builder-append-range.js';

const owner = 'System.Text.StringBuilder';

/** Append the ranged source-builder signature after the released Decimal append contract. */
export function registerStringBuilderValueRangeExtensions({member}) {
  member(owner, 'Append', [owner, 'int', 'int'], owner);
}

function selectedText(platform, source, start, count) {
  const storage = platform.heap.get(platform.get(source, '$data')).data;
  const liveCount = platform.get(source, '$count', 0);
  const parts = [];
  for (let index = 0; index < liveCount && count > 0; index++) {
    const chunk = string(platform, storage[index]);
    if (start >= chunk.length) {
      start -= chunk.length;
      continue;
    }
    const taken = Math.min(count, chunk.length - start);
    parts.push(start === 0 && taken === chunk.length ? chunk : chunk.slice(start, start + taken));
    count -= taken;
    start = 0;
  }
  return parts.join('');
}

/** Capture only the selected UTF-16 range before writes; platform invocation roots both original builders. */
export function appendBuilderValueRange(platform, destination, values, scalars, appendText) {
  const start = nonnegativeIndex(platform, scalars[1], 'startIndex');
  const count = nonnegativeIndex(platform, scalars[2], 'count');
  const source = values[0];
  if (source === null) {
    if (start !== 0 || count !== 0) fail(platform, 'ArgumentNullException', "A builder is required. (Parameter 'value')");
    return destination;
  }
  if (platform.record(source).type !== owner) fail(platform, 'InvalidCastException', 'A StringBuilder source is required');
  // Native ignores upper bounds for nonnull zero-count input, even when start is Int32.MaxValue.
  if (count === 0) return destination;
  if (start > platform.get(source, '$length', 0) - count) {
    fail(platform, 'ArgumentOutOfRangeException', "Range exceeds the source builder. (Parameter 'startIndex')");
  }
  if (count > MAX - platform.get(destination, '$length', 0)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  return appendText(platform, destination, selectedText(platform, source, start, count));
}
