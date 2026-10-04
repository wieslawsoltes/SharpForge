import {fail} from '../host.js';
import {compareOrdinalIgnoreCase} from './string-compare.js';

const comparisonType = 'System.StringComparison';

/** Append enum metadata and the two mode-aware overloads at the ordered A07 tail. */
export function registerStringEqualityExtensions({define, member}) {
  define(comparisonType, {kind: 'enum', base: 'System.Enum', values: {
    CurrentCulture: 0,
    CurrentCultureIgnoreCase: 1,
    InvariantCulture: 2,
    InvariantCultureIgnoreCase: 3,
    Ordinal: 4,
    OrdinalIgnoreCase: 5
  }});
  member('System.String', 'Equals', ['string', 'string', comparisonType], 'bool', {isStatic: true});
  member('System.String', 'Equals', ['string', comparisonType], 'bool');
}

/** Mode validation precedes equality/null shortcuts; culture modes are explicitly unsupported. */
export function equalsWithComparison(platform, first, second, mode) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 5) {
    fail(platform, 'ArgumentException', "Invalid string comparison type. (Parameter 'comparisonType')");
  }
  if (mode < 4) {
    fail(platform, 'NotSupportedException',
      'String.Equals supports only StringComparison.Ordinal and OrdinalIgnoreCase; culture modes are not implemented');
  }
  if (first === second) return true;
  if (first === null || second === null) return false;
  if (mode === 4 || first.length !== second.length) return false;
  return compareOrdinalIgnoreCase(first, second) === 0;
}
