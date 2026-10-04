import {fail} from '../host.js';
import {compareOrdinal} from './string-comparer.js';
import {compareOrdinalIgnoreCase, compareOrdinalIgnoreCaseRange, compareOrdinalRange} from './string-compare.js';
import {validateStringComparisonMode} from './string-comparison-mode.js';

export {validateStringComparisonMode} from './string-comparison-mode.js';

/** Reject valid culture modes after the caller has checked its native argument precedence. */
export function requireOrdinalStringComparison(platform, mode, member) {
  if (mode < 4) {
    fail(platform, 'NotSupportedException',
      `String.${member} supports only StringComparison.Ordinal and OrdinalIgnoreCase; culture modes are not implemented`);
  }
}

/** Validate the enum before operation-specific shortcuts; culture modes remain unsupported. */
export function validateStringComparison(platform, mode, member) {
  validateStringComparisonMode(platform, mode);
  requireOrdinalStringComparison(platform, mode, member);
}

/** Compare nullable strings without allocating folded copies; only the result sign is specified. */
export function compareWithComparison(platform, first, second, mode) {
  validateStringComparison(platform, mode, 'Compare');
  return mode === 4 ? compareOrdinal(first, second) : compareOrdinalIgnoreCase(first, second);
}

/** Validate comparison mode before null/range shortcuts; compare only independently clipped UTF-16 ranges. */
export function compareRangeWithComparison(platform, args) {
  validateStringComparison(platform, args[5], 'Compare');
  return args[5] === 4 ? compareOrdinalRange(platform, args) : compareOrdinalIgnoreCaseRange(platform, args);
}
