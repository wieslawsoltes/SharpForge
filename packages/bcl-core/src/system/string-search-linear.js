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

function searchCore(source, needle, startIndex, endIndex, findLast) {
  const leading = isLow(needle.charCodeAt(0)) ? 1 : 0;
  const trailing = isHigh(needle.charCodeAt(needle.length - 1)) ? 1 : 0;
  // Only these two units can pair outside a candidate. Match them raw around the stable folded core.
  const length = needle.length - leading - trailing;
  if (length === 0) return searchRawEndpoints(source, needle, startIndex, endIndex, findLast);
  let start = startIndex + leading;
  const last = endIndex - needle.length + leading;
  if (leading) {
    // Skip only impossible initial windows; later endpoint rejections keep the existing period state.
    const firstUnit = needle.charCodeAt(0);
    while (start <= last && source.charCodeAt(start - 1) !== firstUnit) start++;
    if (start > last) return -1;
  }
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
  let result = -1;
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

function searchRawEndpoints(source, needle, startIndex, endIndex, findLast) {
  const last = endIndex - needle.length;
  let result = -1;
  for (let start = startIndex; start <= last; start++) {
    if (source.charCodeAt(start) === needle.charCodeAt(0) &&
        (needle.length === 1 || source.charCodeAt(start + 1) === needle.charCodeAt(1))) {
      if (!findLast) return start;
      result = start;
    }
  }
  return result;
}

function searchOrdinalIgnoreCase(source, needle, startIndex, endIndex, findLast) {
  if (needle.length === 0) return findLast ? endIndex : startIndex;
  if (needle.length > endIndex - startIndex) return -1;
  return searchCore(source, needle, startIndex, endIndex, findLast);
}

/** First match in a validated UTF-16 window: linear folded reads, constant space, no transformed strings. */
export function indexOfOrdinalIgnoreCase(source, needle, startIndex = 0, endIndex = source.length) {
  return searchOrdinalIgnoreCase(source, needle, startIndex, endIndex, false);
}

/** Last match before a validated exclusive end; overlapping matches retain the continuing scan's period memory. */
export function lastIndexOfOrdinalIgnoreCase(source, needle, endIndex = source.length) {
  return searchOrdinalIgnoreCase(source, needle, 0, endIndex, true);
}
