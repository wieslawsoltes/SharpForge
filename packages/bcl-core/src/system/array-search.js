import {fail} from '../host.js';
import {compareObjects} from './object-comparison.js';
import {resolveStringComparer} from './string-comparer.js';
import {defaultStringOrdering} from '../globalization/string-ordering.js';
import {comparisonFailure} from './comparison-fault.js';

/** Search a vector through IComparer, returning a match or the complemented insertion index. */
export function searchWithComparer(platform, source, args) {
  if (source.methodTable.rank !== 1) fail(platform, 'RankException', 'Only one-dimensional arrays are supported');
  if (!source.methodTable.flags.szArray) {
    fail(platform, 'NotSupportedException', 'Arrays with explicit lower bounds are not supported by this execution profile');
  }
  // Empty arrays never call the comparer, even if its implementation is unsupported.
  if (source.data.length === 0) return -1;
  const compare = args[2] === null
    ? (first, second) => defaultStringOrdering(platform).compare(first, second)
    : resolveStringComparer(platform, args[2]);
  const elementType = source.methodTable.elementType;
  return binarySearchIndices(source.data.length, index => {
    try { return compareObjects(platform, source.data[index], args[1], compare, elementType); }
    catch (error) { comparisonFailure(platform, error); }
  });
}

/** The common bounded search loop: comparator zero is equality, negatives move the lower bound. */
export function binarySearchIndices(length, compareAt) {
  let lower = 0;
  let upper = length - 1;
  while (lower <= upper) {
    const middle = (lower + upper) >>> 1;
    const order = compareAt(middle);
    if (order === 0) return middle;
    if (order < 0) lower = middle + 1;
    else upper = middle - 1;
  }
  return ~lower;
}
