import { ranges as firstRanges } from './ranges-0.generated.js';
import { ranges as secondRanges } from './ranges-1.generated.js';

export const unicodeGraphemeVersion = '16.0.0';
export const BreakClass = Object.freeze({
  Other: 0, CR: 1, LF: 2, Control: 3, Extend: 4, ZWJ: 5, Regional: 6,
  Prepend: 7, SpacingMark: 8, L: 9, V: 10, T: 11, LV: 12, LVT: 13
});
export const GraphemeProperty = Object.freeze({ Pictographic: 0x10, Consonant: 0x20, Linker: 0x40, IndicExtend: 0x80 });

/** Unicode 16.0 GCB and Indic/emoji context flags; lookup is logarithmic in the immutable range table. */
export function graphemeProperties(code) {
  if (code >= 32 && code <= 126) return BreakClass.Other;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? BreakClass.LV : BreakClass.LVT;
  const ranges = code <= firstRanges[firstRanges.length - 2] ? firstRanges : secondRanges;
  let low = 0;
  let high = ranges.length / 3;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const index = middle * 3;
    if (code < ranges[index]) high = middle;
    else if (code > ranges[index + 1]) low = middle + 1;
    else return ranges[index + 2];
  }
  return BreakClass.Other;
}
