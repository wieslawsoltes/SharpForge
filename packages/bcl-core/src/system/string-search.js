import {fail} from '../host.js';
import {indexOfOrdinalIgnoreCase} from './string-search-linear.js';
import {validateStringComparison} from './string-comparison.js';

/** Append after the mode-aware range Compare contract at the ordered A07 tail. */
export function registerStringSearchExtensions({member}) {
  member('System.String', 'Contains', ['string', 'System.StringComparison'], 'bool');
  member('System.String', 'IndexOf', ['string', 'System.StringComparison'], 'int');
}

/** Preserve Contains validation and diagnostics while sharing the first-match search. */
export function containsWithComparison(platform, receiver, value, mode) {
  return indexOfWithComparison(platform, receiver, value, mode, 'Contains') >= 0;
}

/** Return the first UTF-16 offset or -1; ignore-case uses linear time and constant auxiliary space. */
export function indexOfWithComparison(platform, receiver, value, mode, member = 'IndexOf') {
  if (value === null) fail(platform, 'ArgumentNullException', "Search value cannot be null. (Parameter 'value')");
  validateStringComparison(platform, mode, member);
  if (value.length > receiver.length) return -1;
  if (value.length === 0 || receiver === value) return 0;
  if (mode === 4) return receiver.indexOf(value);
  return indexOfOrdinalIgnoreCase(receiver, value);
}
