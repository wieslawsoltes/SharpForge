import {ordinalUpper} from './string-compare.js';

const isHigh = unit => unit >= 0xd800 && unit <= 0xdbff;
const isLow = unit => unit >= 0xdc00 && unit <= 0xdfff;

// This view is fixed to the complete input, never to the current search window.
function foldedUnit(text, index) {
  const unit = text.charCodeAt(index);
  if (isHigh(unit) && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1);
    if (isLow(low)) {
      const point = 0x10000 + (unit - 0xd800) * 1024 + low - 0xdc00;
      return 0xd800 + ((ordinalUpper(point) - 0x10000) >>> 10);
    }
  } else if (isLow(unit) && index > 0) {
    const high = text.charCodeAt(index - 1);
    if (isHigh(high)) {
      const point = 0x10000 + (high - 0xd800) * 1024 + unit - 0xdc00;
      return 0xdc00 + ((ordinalUpper(point) - 0x10000) & 1023);
    }
  }
  return ordinalUpper(unit);
}

// Find an ordered maximal suffix and its period. Running both alphabet orders gives a critical cut.
function maximalSuffix(needle, beginning, length, reverse) {
  let suffix = 0;
  let candidate = 1;
  let matched = 0;
  let period = 1;
  while (candidate + matched < length) {
    const left = foldedUnit(needle, beginning + suffix + matched);
    const right = foldedUnit(needle, beginning + candidate + matched);
    if (left === right) {
      matched++;
      if (matched === period) {
        candidate += period;
        matched = 0;
      }
    } else if (reverse ? right < left : right > left) {
      suffix = candidate;
      candidate++;
      matched = 0;
      period = 1;
    } else {
      candidate += matched + 1;
      matched = 0;
      period = candidate - suffix;
    }
  }
  return {cut: suffix, period};
}

function searchCore(source, needle, leading, trailing, findLast) {
  const length = needle.length - leading - trailing;
  const forward = maximalSuffix(needle, leading, length, false);
  const backward = maximalSuffix(needle, leading, length, true);
  const factor = forward.cut > backward.cut ? forward : backward;
  const cut = factor.cut;
  let period = factor.period;
  let remember = length - period;
  for (let index = 0; index < cut; index++) {
    if (foldedUnit(needle, leading + index) !== foldedUnit(needle, leading + period + index)) {
      // A conservative nonperiodic shift: at least half the core, no larger than its proven period bound.
      period = Math.max(cut, length - cut);
      remember = 0;
      break;
    }
  }
  let memory = 0;
  let start = leading;
  let result = -1;
  const last = source.length - needle.length + leading;
  while (start <= last) {
    let index = Math.max(cut, memory);
    while (index < length && foldedUnit(needle, leading + index) === foldedUnit(source, start + index)) index++;
    if (index < length) {
      start += index - cut + 1;
      memory = 0;
      continue;
    }
    index = cut;
    while (index > memory && foldedUnit(needle, leading + index - 1) === foldedUnit(source, start + index - 1)) index--;
    if (index <= memory &&
        (!leading || source.charCodeAt(start - 1) === needle.charCodeAt(0)) &&
        (!trailing || source.charCodeAt(start + length) === needle.charCodeAt(needle.length - 1))) {
      if (!findLast) return start - leading;
      result = start - leading;
    }
    // Both rejected endpoints and recorded last matches retain the core's period overlap.
    start += period;
    memory = remember;
  }
  return result;
}

function searchRawEndpoints(source, needle, findLast) {
  const last = source.length - needle.length;
  let result = -1;
  for (let start = 0; start <= last; start++) {
    if (source.charCodeAt(start) === needle.charCodeAt(0) &&
        (needle.length === 1 || source.charCodeAt(start + 1) === needle.charCodeAt(1))) {
      if (!findLast) return start;
      result = start;
    }
  }
  return result;
}

function searchOrdinalIgnoreCase(source, needle, findLast) {
  if (needle.length === 0) return findLast ? source.length : 0;
  if (needle.length > source.length) return -1;
  const leading = isLow(needle.charCodeAt(0)) ? 1 : 0;
  const trailing = isHigh(needle.charCodeAt(needle.length - 1)) ? 1 : 0;
  // Only these two units can be paired outside a candidate. Match them raw and search the stable folded core.
  return needle.length === leading + trailing
    ? searchRawEndpoints(source, needle, findLast)
    : searchCore(source, needle, leading, trailing, findLast);
}

/** First UTF-16 match using Two-Way search: O(n+m) folded reads, O(1) auxiliary space, no transformed strings. */
export function indexOfOrdinalIgnoreCase(source, needle) {
  return searchOrdinalIgnoreCase(source, needle, false);
}

/** Last UTF-16 match with one continuing Two-Way scan; overlapping matches retain period memory. */
export function lastIndexOfOrdinalIgnoreCase(source, needle) {
  return searchOrdinalIgnoreCase(source, needle, true);
}
