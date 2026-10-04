import {simpleUpperPoint} from './casing.js';
import {fail} from '../host.js';

function invalidRange(platform, parameter) {
  fail(platform, 'ArgumentOutOfRangeException', `String comparison range is outside the supported bounds. (Parameter '${parameter}')`);
}

/** Compare nullable UTF-16 slices without substrings; null ordering precedes all range validation. */
export function compareOrdinalRange(platform, args) {
  const [first, indexA, second, indexB, length] = args;
  if (first === null || second === null) return first === second ? 0 : first === null ? -1 : 1;
  if (typeof first !== 'string' || typeof second !== 'string') fail(platform, 'ArgumentException', 'Strings are required');
  if (!Number.isInteger(length) || length < 0 || length > 2147483647) invalidRange(platform, 'length');
  // Negative indices precede both upper-bound checks, even when the requested length is zero.
  if (!Number.isInteger(indexA) || indexA < 0) invalidRange(platform, 'indexA');
  if (!Number.isInteger(indexB) || indexB < 0) invalidRange(platform, 'indexB');
  const firstLength = Math.min(length, first.length - indexA);
  const secondLength = Math.min(length, second.length - indexB);
  if (firstLength < 0) invalidRange(platform, 'indexA');
  if (secondLength < 0) invalidRange(platform, 'indexB');
  if (length === 0 || first === second && indexA === indexB) return 0;
  const compared = Math.min(firstLength, secondLength);
  for (let offset = 0; offset < compared; offset++) {
    const difference = first.charCodeAt(indexA + offset) - second.charCodeAt(indexB + offset);
    if (difference !== 0) return difference;
  }
  return firstLength - secondLength;
}

function ordinalUpper(point) {
  if (point <= 0x7f) return point >= 0x61 && point <= 0x7a ? point - 0x20 : point;
  // The pinned ordinal capture excludes long s and Garay from invariant-uppercase equivalence.
  if (point === 0x17f || point >= 0x16ebb && point <= 0x16ed3) return point;
  return simpleUpperPoint(point);
}

/** Match a valid UTF-16 range of second.length units without reading beyond either boundary. */
export function equalsOrdinalIgnoreCaseRange(first, start, second) {
  const end = start + second.length;
  let left = start;
  let right = 0;
  while (left < end && right < second.length) {
    // A high surrogate at the range end stays isolated even if the original string continues with a low surrogate.
    const firstPoint = left + 1 < end ? first.codePointAt(left) : first.charCodeAt(left);
    const secondPoint = second.codePointAt(right);
    if (firstPoint !== secondPoint && ordinalUpper(firstPoint) !== ordinalUpper(secondPoint)) return false;
    left += firstPoint > 0xffff ? 2 : 1;
    right += secondPoint > 0xffff ? 2 : 1;
  }
  return left === end && right === second.length;
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
