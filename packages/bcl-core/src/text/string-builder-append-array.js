import {MAX, fail} from '../host.js';
import {nonnegativeIndex} from './string-builder-append-range.js';
import {characterArray, characterArrayText} from './character-array.js';

const owner = 'System.Text.StringBuilder';

/** Append native array signatures after the string-range overload without moving earlier contracts. */
export function registerStringBuilderArrayExtensions({member}) {
  member(owner, 'Append', ['char[]'], owner);
  member(owner, 'Append', ['char[]', 'int', 'int'], owner);
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
  return appendText(platform, reference, characterArrayText(platform, data, start, count));
}
