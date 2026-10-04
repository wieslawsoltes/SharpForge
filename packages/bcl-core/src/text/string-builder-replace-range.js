import {MAX, fail, string} from '../host.js';
import {nonnegativeIndex} from './string-builder-append-range.js';

const owner = 'System.Text.StringBuilder';

/** Register literal string replacement within a UTF-16 window after the released character insertion contract. */
export function registerStringBuilderStringReplaceRangeExtensions({member}) {
  member(owner, 'Replace', ['string', 'string', 'int', 'int'], owner);
}

function rangeError(platform, parameter) {
  fail(platform, 'ArgumentOutOfRangeException', "Range exceeds the builder text. (Parameter '" + parameter + "')");
}

/** Replace nonoverlapping matches wholly inside the original window; bound growth before constructing the result. */
export function replaceBuilderStringRange(platform, reference, values, bufferText, setBuffer) {
  const previous = string(platform, values[0], true);
  if (previous === null) fail(platform, 'ArgumentNullException', "A search string is required. (Parameter 'oldValue')");
  if (previous.length === 0) fail(platform, 'ArgumentException', "The search string cannot be empty. (Parameter 'oldValue')");
  const length = platform.get(reference, '$length', 0);
  const start = nonnegativeIndex(platform, values[2], 'startIndex');
  if (start > length) rangeError(platform, 'startIndex');
  const count = nonnegativeIndex(platform, values[3], 'count');
  if (count > length - start) rangeError(platform, 'count');
  const replacement = string(platform, values[1], true) ?? '';
  if (count === 0 || previous === replacement || previous.length > count) return reference;

  const source = bufferText(platform, reference);
  const parts = source.slice(start, start + count).split(previous);
  const matches = parts.length - 1;
  if (matches === 0) return reference;
  const growth = replacement.length - previous.length;
  if (growth > 0 && matches > Math.floor((MAX - source.length) / growth)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  // String separators and join keep dollar sequences literal and never search the inserted text again.
  const result = source.slice(0, start) + parts.join(replacement) + source.slice(start + count);
  setBuffer(platform, reference, result);
  return reference;
}
