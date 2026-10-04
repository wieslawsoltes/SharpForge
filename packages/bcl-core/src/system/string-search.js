import {fail} from '../host.js';
import {indexOfOrdinalIgnoreCase, lastIndexOfOrdinalIgnoreCase} from './string-search-linear.js';
import {equalsOrdinalIgnoreCaseRange} from './string-compare.js';
import {validateStringComparison, validateStringComparisonMode, requireOrdinalStringComparison} from './string-comparison.js';

/** Append after the mode-aware range Compare contract at the ordered A07 tail. */
export function registerStringSearchExtensions({member}) {
  member('System.String', 'Contains', ['string', 'System.StringComparison'], 'bool');
  member('System.String', 'IndexOf', ['string', 'System.StringComparison'], 'int');
  member('System.String', 'LastIndexOf', ['string', 'System.StringComparison'], 'int');
  member('System.String', 'IndexOf', ['string', 'int', 'System.StringComparison'], 'int');
}

/** Preserve Contains validation and diagnostics while sharing the first-match search. */
export function containsWithComparison(platform, receiver, value, mode) {
  return indexOfWithComparison(platform, receiver, value, mode, 'Contains') >= 0;
}

/** Return the first UTF-16 offset or -1; ignore-case uses linear time and constant auxiliary space. */
export function indexOfWithComparison(platform, receiver, value, mode, member = 'IndexOf') {
  validateSearch(platform, value, mode, member);
  return indexOfValidated(receiver, value, mode, 0);
}

/** Search from an inclusive UTF-16 offset; null, enum and range checks precede the culture guard. */
export function indexOfFromWithComparison(platform, receiver, value, startIndex, mode) {
  validateSearchValue(platform, value);
  validateStringComparisonMode(platform, mode);
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > receiver.length) {
    fail(platform, 'ArgumentOutOfRangeException', "Start index is outside the string. (Parameter 'startIndex')");
  }
  requireOrdinalStringComparison(platform, mode, 'IndexOf');
  return indexOfValidated(receiver, value, mode, startIndex);
}

function indexOfValidated(receiver, value, mode, startIndex) {
  if (value.length > receiver.length - startIndex) return -1;
  if (value.length === 0 || receiver === value) return startIndex;
  if (mode === 4) return receiver.indexOf(value, startIndex);
  // Measured short-needle dispatch avoids factorization; the fixed limit preserves an O(8n) bound.
  if (value.length <= 8) {
    const last = receiver.length - value.length;
    for (let start = startIndex; start <= last; start++) {
      if (equalsOrdinalIgnoreCaseRange(receiver, start, value)) return start;
    }
    return -1;
  }
  return indexOfOrdinalIgnoreCase(receiver, value, startIndex);
}

/** Return the last UTF-16 offset or -1; empty values match at receiver.length after validation. */
export function lastIndexOfWithComparison(platform, receiver, value, mode) {
  validateSearch(platform, value, mode, 'LastIndexOf');
  if (value.length > receiver.length) return -1;
  if (value.length === 0) return receiver.length;
  if (receiver === value) return 0;
  if (mode === 4) return receiver.lastIndexOf(value);
  return lastIndexOfOrdinalIgnoreCase(receiver, value);
}

function validateSearch(platform, value, mode, member) {
  validateSearchValue(platform, value);
  validateStringComparison(platform, mode, member);
}

function validateSearchValue(platform, value) {
  if (value === null) fail(platform, 'ArgumentNullException', "Search value cannot be null. (Parameter 'value')");
}
