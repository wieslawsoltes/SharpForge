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

/** Register after the character StringBuilder Append extensions so earlier A07 IDs remain fixed. */
export function registerStringSearchWindowExtensions({member}) {
  member('System.String', 'IndexOf', ['string', 'int', 'int', 'System.StringComparison'], 'int');
}

/** Append after the StringBuilder indexer contracts without shifting the earlier search registrations. */
export function registerStringLastSearchStartExtensions({member}) {
  member('System.String', 'LastIndexOf', ['string', 'int', 'System.StringComparison'], 'int');
}

/** Preserve Contains validation and diagnostics while sharing the first-match search. */
export function containsWithComparison(platform, receiver, value, mode) {
  return indexOfWithComparison(platform, receiver, value, mode, 'Contains') >= 0;
}

/** Return the first UTF-16 offset or -1; ignore-case uses linear time and constant auxiliary space. */
export function indexOfWithComparison(platform, receiver, value, mode, member = 'IndexOf') {
  validateSearch(platform, value, mode, member);
  return indexOfValidated(receiver, value, mode, 0, receiver.length);
}

/** Search from an inclusive UTF-16 offset; null, enum and range checks precede the culture guard. */
export function indexOfFromWithComparison(platform, receiver, value, startIndex, mode) {
  validateSearchValue(platform, value);
  validateStringComparisonMode(platform, mode);
  validateSearchStart(platform, receiver, startIndex);
  requireOrdinalStringComparison(platform, mode, 'IndexOf');
  return indexOfValidated(receiver, value, mode, startIndex, receiver.length);
}

/** Search a start/count UTF-16 window using the dispatcher's existing scalar argument array. */
export function indexOfWindowWithComparison(platform, receiver, args) {
  const [value, startIndex, count, mode] = args;
  validateSearchValue(platform, value);
  validateStringComparisonMode(platform, mode);
  validateSearchStart(platform, receiver, startIndex);
  if (!Number.isInteger(count) || count < 0 || count > receiver.length - startIndex) {
    fail(platform, 'ArgumentOutOfRangeException', "Count is outside the string. (Parameter 'count')");
  }
  requireOrdinalStringComparison(platform, mode, 'IndexOf');
  return indexOfValidated(receiver, value, mode, startIndex, startIndex + count);
}

function indexOfValidated(receiver, value, mode, startIndex, endIndex) {
  if (value.length > endIndex - startIndex) return -1;
  if (value.length === 0 || receiver === value) return startIndex;
  if (mode === 4) {
    // Native host search may inspect the excluded suffix; clamp the first result without making a substring.
    const result = receiver.indexOf(value, startIndex);
    return result > endIndex - value.length ? -1 : result;
  }
  // Measured short-needle dispatch avoids factorization; the fixed limit preserves an O(8n) bound.
  if (value.length <= 8) {
    const last = endIndex - value.length;
    for (let start = startIndex; start <= last; start++) {
      if (equalsOrdinalIgnoreCaseRange(receiver, start, value)) return start;
    }
    return -1;
  }
  return indexOfOrdinalIgnoreCase(receiver, value, startIndex, endIndex);
}

/** Return the last UTF-16 offset or -1; empty values match at receiver.length after validation. */
export function lastIndexOfWithComparison(platform, receiver, value, mode) {
  validateSearch(platform, value, mode, 'LastIndexOf');
  return lastIndexOfValidated(receiver, value, mode, receiver.length);
}

/** Search the prefix through an inclusive UTF-16 start; Length aliases the end, and empty receivers also accept -1. */
export function lastIndexOfFromWithComparison(platform, receiver, value, startIndex, mode) {
  validateSearchValue(platform, value);
  validateStringComparisonMode(platform, mode);
  const minimum = receiver.length === 0 ? -1 : 0;
  if (!Number.isInteger(startIndex) || startIndex < minimum || startIndex > receiver.length) {
    fail(platform, 'ArgumentOutOfRangeException', "Start index is outside the string. (Parameter 'startIndex')");
  }
  requireOrdinalStringComparison(platform, mode, 'LastIndexOf');
  return lastIndexOfValidated(receiver, value, mode, Math.min(startIndex + 1, receiver.length));
}

function lastIndexOfValidated(receiver, value, mode, endIndex) {
  if (value.length > endIndex) return -1;
  if (value.length === 0) return endIndex;
  if (receiver === value) return 0;
  if (mode === 4) return receiver.lastIndexOf(value, endIndex - value.length);
  return lastIndexOfOrdinalIgnoreCase(receiver, value, endIndex);
}

function validateSearch(platform, value, mode, member) {
  validateSearchValue(platform, value);
  validateStringComparison(platform, mode, member);
}

function validateSearchValue(platform, value) {
  if (value === null) fail(platform, 'ArgumentNullException', "Search value cannot be null. (Parameter 'value')");
}

function validateSearchStart(platform, receiver, startIndex) {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > receiver.length) {
    fail(platform, 'ArgumentOutOfRangeException', "Start index is outside the string. (Parameter 'startIndex')");
  }
}
