import {fail} from '../host.js';
import {nonnegativeIndex} from './string-builder-append-range.js';

/** Validate native length-first ranges before reading chunks; valid empty ranges are true no-ops. */
export function removeBuilderRange(platform, reference, values, bufferText, setBuffer) {
  const length = nonnegativeIndex(platform, values[1], 'length');
  const start = nonnegativeIndex(platform, values[0], 'startIndex');
  if (length > platform.get(reference, '$length', 0) - start) {
    fail(platform, 'ArgumentOutOfRangeException', "Range exceeds the builder text. (Parameter 'length')");
  }
  if (length === 0) return reference;
  const previous = bufferText(platform, reference);
  setBuffer(platform, reference, previous.slice(0, start) + previous.slice(start + length));
  return reference;
}
