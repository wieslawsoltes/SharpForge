import {fail} from '../host.js';
import {equalsOrdinalIgnoreCaseRange} from './string-compare.js';
import {validateStringComparison} from './string-comparison.js';

/** Append after the mode-aware range Compare contract at the ordered A07 tail. */
export function registerStringSearchExtensions({member}) {
  member('System.String', 'Contains', ['string', 'System.StringComparison'], 'bool');
}

/** Search without substring copies: ignore-case is O((n - m + 1) * m) time and constant auxiliary space. */
export function containsWithComparison(platform, receiver, value, mode) {
  if (value === null) fail(platform, 'ArgumentNullException', "Search value cannot be null. (Parameter 'value')");
  validateStringComparison(platform, mode, 'Contains');
  if (value.length > receiver.length) return false;
  if (value.length === 0 || receiver === value) return true;
  if (mode === 4) return receiver.includes(value);
  const last = receiver.length - value.length;
  // Candidate starts are UTF-16 units: a needle may start at a paired low surrogate.
  for (let start = 0; start <= last; start++) {
    if (equalsOrdinalIgnoreCaseRange(receiver, start, value)) return true;
  }
  return false;
}
