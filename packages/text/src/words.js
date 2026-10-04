import { iterateGraphemes } from './graphemes.js';

const LETTER = /[\p{L}\p{N}\p{M}_]/u;
const LOWER = /\p{Ll}/u;
const UPPER = /\p{Lu}/u;
const NUMBER = /\p{N}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function kind(character) {
  if (/\s/u.test(character)) return 'space';
  return LETTER.test(character) ? 'word' : 'punctuation';
}

function* fallbackWords(text) {
  let start = 0;
  let previousKind = '';
  let previousCjk = false;
  for (const item of iterateGraphemes(text)) {
    const currentKind = kind(item.segment);
    const cjk = CJK.test(item.segment);
    if (item.index > start && (currentKind !== previousKind || cjk || previousCjk)) {
      yield { index: start, end: item.index, segment: text.slice(start, item.index), isWordLike: previousKind === 'word' };
      start = item.index;
    }
    previousKind = currentKind;
    previousCjk = cjk;
  }
  if (start < text.length) yield { index: start, end: text.length, segment: text.slice(start), isWordLike: previousKind === 'word' };
}

/** Unicode words with explicit locale and fallback. Offsets use UTF-16, including supplementary-plane letters. */
export function wordSegments(text, { locale = 'und', forceFallback = false, segmenter } = {}) {
  if (typeof text !== 'string') throw new TypeError('Expected text');
  const implementation = segmenter ?? (!forceFallback && typeof Intl?.Segmenter === 'function'
    ? new Intl.Segmenter(locale, { granularity: 'word' }) : null);
  if (!implementation) return Array.from(fallbackWords(text));
  return Array.from(implementation.segment(text), item => ({ ...item, end: item.index + item.segment.length }));
}

/** Camel/Pascal/acronym/digit/underscore boundaries are layered on grapheme boundaries. */
export function subwordBoundaries(text) {
  const items = Array.from(iterateGraphemes(text));
  const boundaries = [0];
  for (let index = 1; index < items.length; index++) {
    const previous = items[index - 1].segment;
    const current = items[index].segment;
    const next = items[index + 1]?.segment ?? '';
    const boundary = kind(previous) !== kind(current) || previous === '_' || current === '_'
      || LOWER.test(previous) && UPPER.test(current)
      || UPPER.test(previous) && UPPER.test(current) && LOWER.test(next)
      || NUMBER.test(previous) !== NUMBER.test(current) && LETTER.test(previous) && LETTER.test(current)
      || CJK.test(previous) || CJK.test(current);
    if (boundary) boundaries.push(items[index].index);
  }
  if (boundaries.at(-1) !== text.length) boundaries.push(text.length);
  return boundaries;
}

/** Move to the next word/punctuation boundary, consuming following whitespace in the same step. */
export function nextWordOffset(text, offset, options = {}) {
  offset = Math.max(0, Math.min(text.length, offset));
  if (options.subword) return subwordBoundaries(text).find(boundary => boundary > offset) ?? text.length;
  const segments = wordSegments(text, options);
  let index = segments.findIndex(segment => segment.end > offset);
  if (index < 0) return text.length;
  let target = segments[index].end;
  while (index + 1 < segments.length && /^\s+$/u.test(segments[index + 1].segment)) target = segments[++index].end;
  return target;
}

export function previousWordOffset(text, offset, options = {}) {
  offset = Math.max(0, Math.min(text.length, offset));
  if (options.subword) return subwordBoundaries(text).findLast(boundary => boundary < offset) ?? 0;
  const segments = wordSegments(text, options);
  let index = segments.findLastIndex(segment => segment.index < offset);
  while (index >= 0 && /^\s+$/u.test(segments[index].segment)) index--;
  return index < 0 ? 0 : segments[index].index;
}

export function wordRangeAt(text, offset, options) {
  const segments = wordSegments(text, options);
  return segments.find(segment => segment.isWordLike && segment.index <= offset && segment.end > offset)
    ?? segments.findLast(segment => segment.isWordLike && segment.end === offset)
    ?? { index: offset, end: offset, segment: '', isWordLike: false };
}
