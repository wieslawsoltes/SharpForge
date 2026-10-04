const EXTEND = /\p{Grapheme_Extend}/u;
const SPACING = /\p{Mc}/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL = /\p{Regional_Indicator}/u;
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}]/u;

function hangul(code) {
  if (code >= 0x1100 && code <= 0x115f || code >= 0xa960 && code <= 0xa97c) return 'L';
  if (code >= 0x1160 && code <= 0x11a7 || code >= 0xd7b0 && code <= 0xd7c6) return 'V';
  if (code >= 0x11a8 && code <= 0x11ff || code >= 0xd7cb && code <= 0xd7fb) return 'T';
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? 'LV' : 'LVT';
  return '';
}

function prepend(code) {
  return code >= 0x600 && code <= 0x605 || [0x6dd, 0x70f, 0x890, 0x891, 0x8e2, 0xd4e, 0x110bd, 0x110cd].includes(code)
    || code >= 0x111c2 && code <= 0x111c3 || code >= 0x1193f && code <= 0x11941 || code >= 0x11a84 && code <= 0x11a89;
}

function linker(code) {
  return [0x94d, 0x9cd, 0xacd, 0xb4d, 0xc4d, 0xd4d, 0x1039, 0x17d2, 0x1a60, 0x1b44, 0xa9c0, 0xaaf6].includes(code);
}

function joinsHangul(previous, current) {
  return previous === 'L' && ['L', 'V', 'LV', 'LVT'].includes(current)
    || ['LV', 'V'].includes(previous) && ['V', 'T'].includes(current)
    || ['LVT', 'T'].includes(previous) && current === 'T';
}

/** Deterministic fallback for extended clusters: CRLF, Hangul, marks, emoji/ZWJ, flags and common Indic linkers. */
function* fallbackSegments(text) {
  let start = 0;
  let previous = '';
  let previousCode = -1;
  let regionalCount = 0;
  let pictographicBeforeJoiner = false;
  let lastBasePictographic = false;
  let previousLinker = false;
  for (let offset = 0; offset < text.length;) {
    const code = text.codePointAt(offset);
    const current = String.fromCodePoint(code);
    const extend = EXTEND.test(current) || code >= 0x1f3fb && code <= 0x1f3ff;
    const controlBoundary = CONTROL.test(previous) || CONTROL.test(current);
    const join = offset === 0 || previousCode === 13 && code === 10 || !controlBoundary && (
      joinsHangul(hangul(previousCode), hangul(code)) || extend || code === 0x200d || SPACING.test(current)
      || prepend(previousCode) || previousCode === 0x200d && pictographicBeforeJoiner && PICTOGRAPHIC.test(current)
      || REGIONAL.test(previous) && REGIONAL.test(current) && regionalCount % 2 === 1
      || previousLinker && /\p{L}/u.test(current)
    );
    if (!join) {
      yield { segment: text.slice(start, offset), index: start, end: offset };
      start = offset;
      regionalCount = 0;
      lastBasePictographic = false;
      previousLinker = false;
    }
    if (code === 0x200d) pictographicBeforeJoiner = lastBasePictographic;
    else if (!extend) lastBasePictographic = PICTOGRAPHIC.test(current);
    previousLinker = linker(code) || (extend || code === 0x200d) && previousLinker;
    regionalCount = REGIONAL.test(current) ? regionalCount + 1 : 0;
    previous = current;
    previousCode = code;
    offset += current.length;
  }
  if (start < text.length) yield { segment: text.slice(start), index: start, end: text.length };
}

/** Explicit reusable segmentation service; Intl supplies the host's Unicode version, with a documented fallback. */
export class GraphemeSegmenter {
  constructor({ locale = 'und', forceFallback = false, segmenter } = {}) {
    this.segmenter = segmenter ?? (!forceFallback && typeof Intl?.Segmenter === 'function'
      ? new Intl.Segmenter(locale, { granularity: 'grapheme' }) : null);
  }
  *segments(text) {
    if (typeof text !== 'string') throw new TypeError('Expected text');
    if (!this.segmenter) { yield* fallbackSegments(text); return; }
    for (const item of this.segmenter.segment(text)) {
      yield { segment: item.segment, index: item.index, end: item.index + item.segment.length };
    }
  }
  next(text, offset) {
    offset = Math.max(0, Math.min(text.length, Math.trunc(offset)));
    if (offset === text.length) return offset;
    if (this.segmenter) {
      const item = this.segmenter.segment(text).containing(offset);
      return item.index + item.segment.length;
    }
    for (const item of this.segments(text)) if (item.end > offset) return item.end;
    return text.length;
  }
  previous(text, offset) {
    offset = Math.max(0, Math.min(text.length, Math.trunc(offset)));
    if (offset === 0) return 0;
    if (this.segmenter) return this.segmenter.segment(text).containing(offset - 1).index;
    for (const item of this.segments(text)) if (item.end >= offset) return item.index;
    return 0;
  }
}

function service(options) { return options?.segmenter instanceof GraphemeSegmenter ? options.segmenter : new GraphemeSegmenter(options); }

/** Iterate clusters with UTF-16 start/end offsets. Pass a service instance for repeated hot-path calls. */
export function iterateGraphemes(text, options) { return service(options).segments(text); }
export function graphemeSegments(text, options) { return Array.from(iterateGraphemes(text, options)); }
export function nextGraphemeOffset(text, offset, options) { return service(options).next(text, offset); }
export function previousGraphemeOffset(text, offset, options) { return service(options).previous(text, offset); }
