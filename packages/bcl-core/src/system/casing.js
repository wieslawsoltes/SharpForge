import {upperCaseRanges} from './unicode-upper-case.js';
import {lowerCaseRanges} from './unicode-lower-case.js';

const ascii = /^[\x00-\x7f]*$/;

function mappedPoint(point, ranges) {
  let lower = 0;
  let upper = ranges.length / 4 - 1;
  while (lower <= upper) {
    const middle = (lower + upper) >>> 1;
    const offset = middle * 4;
    const start = ranges[offset];
    if (point < start) upper = middle - 1;
    else if (point > ranges[offset + 1]) lower = middle + 1;
    else return (point - start) % ranges[offset + 3] === 0 ? point + ranges[offset + 2] : point;
  }
  return point;
}

/** Read one captured simple uppercase mapping without constructing a transformed string. */
export function simpleUpperPoint(point) {
  return mappedPoint(point, upperCaseRanges);
}

/** Apply pinned .NET simple invariant scalar mappings, preserving UTF-16 length and isolated surrogates. */
export function invariantCase(value, upper) {
  // Native casing is equivalent only within ASCII; Unicode always uses the captured simple mapping.
  if (ascii.test(value)) return upper ? value.toUpperCase() : value.toLowerCase();
  const ranges = upper ? upperCaseRanges : lowerCaseRanges;
  const parts = [];
  let unchangedStart = 0;
  for (let index = 0; index < value.length;) {
    const point = value.codePointAt(index);
    const width = point > 0xffff ? 2 : 1;
    const mapped = mappedPoint(point, ranges);
    if (mapped !== point) {
      parts.push(value.slice(unchangedStart, index), String.fromCodePoint(mapped));
      unchangedStart = index + width;
    }
    index += width;
  }
  if (!parts.length) return value;
  parts.push(value.slice(unchangedStart));
  return parts.join('');
}
