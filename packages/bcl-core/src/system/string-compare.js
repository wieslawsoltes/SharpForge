import {simpleUpperPoint} from './casing.js';

function ordinalUpper(point) {
  if (point <= 0x7f) return point >= 0x61 && point <= 0x7a ? point - 0x20 : point;
  // The pinned ordinal capture excludes long s and Garay from invariant-uppercase equivalence.
  if (point === 0x17f || point >= 0x16ebb && point <= 0x16ed3) return point;
  return simpleUpperPoint(point);
}

/** Compare nullable strings with the captured ordinal fold in O(n) time and constant auxiliary space. */
export function compareOrdinalIgnoreCase(first, second) {
  if (first === second) return 0;
  if (first === null) return -1;
  if (second === null) return 1;
  let left = 0;
  let right = 0;
  while (left < first.length && right < second.length) {
    const firstPoint = first.codePointAt(left);
    const secondPoint = second.codePointAt(right);
    if (firstPoint !== secondPoint) {
      const firstUpper = ordinalUpper(firstPoint);
      const secondUpper = ordinalUpper(secondPoint);
      // Native ordinal-ignore-case orders complete supplementary scalars above BMP/unpaired units.
      if (firstUpper !== secondUpper) return firstUpper < secondUpper ? -1 : 1;
    }
    left += firstPoint > 0xffff ? 2 : 1;
    right += secondPoint > 0xffff ? 2 : 1;
  }
  return first.length === second.length ? 0 : first.length < second.length ? -1 : 1;
}
