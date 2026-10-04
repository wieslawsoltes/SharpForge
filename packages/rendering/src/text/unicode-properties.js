import {ranges as categoryRanges, names as categoryNames} from '../../vendor/unicode/categories.js';
import {ranges as pictographicRanges} from '../../vendor/unicode/extended-pictographic.js';

/** Read a pinned Unicode17 property in O(log(number of disjoint ranges)). */
export function unicodeProperty(ranges, codePoint) {
  let low = 0;
  let high = ranges.length / 3;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle * 3 + 1] < codePoint) low = middle + 1;
    else high = middle;
  }
  return low * 3 < ranges.length && ranges[low * 3] <= codePoint ? ranges[low * 3 + 2] : 0;
}

export function unicodeCategory(codePoint) { return categoryNames[unicodeProperty(categoryRanges, codePoint)]; }
export function unicodeExtendedPictographic(codePoint) { return Boolean(unicodeProperty(pictographicRanges, codePoint)); }
