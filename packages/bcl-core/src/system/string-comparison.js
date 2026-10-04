import {fail} from '../host.js';
import {compareOrdinal} from './string-comparer.js';
import {compareOrdinalIgnoreCase} from './string-compare.js';

/** Validate the enum before operation-specific shortcuts; culture modes remain unsupported. */
export function validateStringComparison(platform, mode, member) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 5) {
    fail(platform, 'ArgumentException', "Invalid string comparison type. (Parameter 'comparisonType')");
  }
  if (mode < 4) {
    fail(platform, 'NotSupportedException',
      `String.${member} supports only StringComparison.Ordinal and OrdinalIgnoreCase; culture modes are not implemented`);
  }
}

/** Compare nullable strings without allocating folded copies; only the result sign is specified. */
export function compareWithComparison(platform, first, second, mode) {
  validateStringComparison(platform, mode, 'Compare');
  return mode === 4 ? compareOrdinal(first, second) : compareOrdinalIgnoreCase(first, second);
}
