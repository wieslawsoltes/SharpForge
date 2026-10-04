import {MAX, fail, string} from '../host.js';

const owner = 'System.Text.StringBuilder';

/** Append the string-range contract at the ordered A07 tail after string search 524318. */
export function registerStringBuilderRangeExtensions({member}) {
  member(owner, 'Append', ['string', 'int', 'int'], owner);
}

/** Validate a builder range operand as a nonnegative Int32, retaining its native parameter name. */
export function nonnegativeIndex(platform, value, parameter) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
    fail(platform, 'ArgumentOutOfRangeException', "Value is outside the supported range. (Parameter '" + parameter + "')");
  }
  return value;
}

/** Append one validated UTF-16 slice, retaining native zero-count no-ops and existing chunk fault behavior. */
export function appendBuilderRange(platform, reference, values, appendText) {
  const start = nonnegativeIndex(platform, values[1], 'startIndex');
  const count = nonnegativeIndex(platform, values[2], 'count');
  const value = string(platform, values[0], true);
  if (value === null) {
    if (start !== 0 || count !== 0) fail(platform, 'ArgumentNullException', "A string is required. (Parameter 'value')");
    return reference;
  }
  // Native Append(string, int, int) does not check upper bounds when count is zero.
  if (count === 0) return reference;
  if (start > value.length - count) {
    fail(platform, 'ArgumentOutOfRangeException', "Range exceeds the input string. (Parameter 'startIndex')");
  }
  if (count > MAX - platform.get(reference, '$length', 0)) {
    fail(platform, 'OutOfMemoryException', 'StringBuilder host text allocation limit exceeded');
  }
  return appendText(platform, reference, value.slice(start, start + count));
}
