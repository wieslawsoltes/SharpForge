import {MAX, bclScalar, fail} from '../host.js';
import {characterArray, characterArrayText} from './character-array.js';
import {nonnegativeIndex} from './string-builder-append-range.js';
import {insertionIndex} from './string-builder-edit.js';
import {insertValidatedBuilderText} from './string-builder-insert-values.js';

const owner = 'System.Text.StringBuilder';

/** Append whole and ranged Char-array insertion after scalar/Object insertion contracts. */
export function registerStringBuilderArrayInsertExtensions({member}) {
  member(owner, 'Insert', ['int', 'char[]'], owner);
  member(owner, 'Insert', ['int', 'char[]', 'int', 'int'], owner);
}

/** Validate native index/null/range precedence, then decode only the selected bounded UTF-16 array slice. */
export function insertBuilderArray(platform, reference, values, insertText) {
  const index = insertionIndex(platform, reference, bclScalar(platform, values[0]));
  const full = values.length === 2;
  let start = full ? 0 : bclScalar(platform, values[2]);
  let count = full ? 0 : bclScalar(platform, values[3]);
  if (values[1] === null) {
    if (start !== 0 || count !== 0) fail(platform, 'ArgumentNullException', "A character array is required. (Parameter 'value')");
    return reference;
  }
  start = nonnegativeIndex(platform, start, 'startIndex');
  count = nonnegativeIndex(platform, count, 'charCount');
  const data = characterArray(platform, values[1]);
  if (full) count = data.length;
  if (start > data.length - count) {
    fail(platform, 'ArgumentOutOfRangeException', "Range exceeds the character array. (Parameter 'startIndex')");
  }
  if (count === 0) return reference;
  if (count > MAX - platform.get(reference, '$length', 0)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  const value = characterArrayText(platform, data, start, count);
  return insertValidatedBuilderText(platform, reference, index, value, insertText);
}
