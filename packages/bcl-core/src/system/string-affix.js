import {fail} from '../host.js';
import {equalsOrdinalIgnoreCaseRange} from './string-compare.js';
import {validateStringComparison} from './string-comparison.js';

/** Append after the registered mode-aware Compare contract at the ordered A07 tail. */
export function registerStringAffixExtensions({member}) {
  member('System.String', 'StartsWith', ['string', 'System.StringComparison'], 'bool');
  member('System.String', 'EndsWith', ['string', 'System.StringComparison'], 'bool');
}

/** Receiver validation belongs to dispatch; a null value precedes mode validation and shortcuts. */
export function affixWithComparison(platform, receiver, value, mode, fromEnd) {
  if (value === null) fail(platform, 'ArgumentNullException', "Affix value cannot be null. (Parameter 'value')");
  validateStringComparison(platform, mode, fromEnd ? 'EndsWith' : 'StartsWith');
  if (value.length > receiver.length) return false;
  if (value.length === 0 || receiver === value) return true;
  if (mode === 4) return fromEnd ? receiver.endsWith(value) : receiver.startsWith(value);
  const start = fromEnd ? receiver.length - value.length : 0;
  return equalsOrdinalIgnoreCaseRange(receiver, start, value);
}
