import {getEmbeddingLevels, getReorderSegments} from '../../vendor/bidi/src/index.js';
import {getBidiCharType, TRAILING_TYPES} from '../../vendor/bidi/src/charTypes.js';

/** Run the pinned UAX9 implementation over Unicode scalars, then expand levels to UTF-16.
 * Its character-sequence indexing accepts an array, avoiding surrogate halves being classified independently.
 */
export function textBidi(text, direction = 'auto') {
  const characters = [];
  const starts = [];
  for (let index = 0; index < text.length;) {
    const value = String.fromCodePoint(text.codePointAt(index));
    starts.push(index);
    characters.push(value);
    index += value.length;
  }
  starts.push(text.length);
  const embedding = getEmbeddingLevels(characters, direction);
  const levels = new Uint8Array(text.length);
  for (let index = 0; index < characters.length; index++) levels.fill(embedding.levels[index], starts[index], starts[index + 1]);
  const paragraphs = embedding.paragraphs.map(paragraph => ({start: starts[paragraph.start],
    end: starts[paragraph.end + 1], level: paragraph.level}));
  return {characters, starts, embedding, levels, paragraphs};
}

function characterIndex(starts, position) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle] < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** L1 resets trailing whitespace before shaping directional items, including soft line breaks. */
export function lineBidiTail(bidi, start, end) {
  const first = characterIndex(bidi.starts, start);
  let last = characterIndex(bidi.starts, end) - 1;
  let low = 0, high = bidi.paragraphs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bidi.paragraphs[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  const level = bidi.paragraphs[low]?.level ?? 0;
  while (last >= first && (getBidiCharType(bidi.characters[last]) & TRAILING_TYPES)) last--;
  return {start: bidi.starts[last + 1], level};
}

/** Return whole shaped items in visual order; HarfBuzz already orders glyphs within each directional item. */
export function visualTextItems(bidi, items, start, end) {
  if (items.length < 2 || start >= end) return items.slice();
  const first = characterIndex(bidi.starts, start);
  const last = characterIndex(bidi.starts, end) - 1;
  let low = 0;
  let high = bidi.embedding.paragraphs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bidi.embedding.paragraphs[middle].end < first) low = middle + 1;
    else high = middle;
  }
  const paragraphs = [];
  for (let index = low; index < bidi.embedding.paragraphs.length && bidi.embedding.paragraphs[index].start <= last; index++) {
    paragraphs.push(bidi.embedding.paragraphs[index]);
  }
  const segments = getReorderSegments(bidi.characters, {...bidi.embedding, paragraphs}, first, last);
  const indices = Array.from({length: last - first + 1}, (_, index) => first + index);
  for (const [left, right] of segments) {
    for (let offset = 0; offset < (right - left + 1) / 2; offset++) {
      const a = left - first + offset;
      const b = right - first - offset;
      [indices[a], indices[b]] = [indices[b], indices[a]];
    }
  }
  const ranks = new Int32Array(indices.length);
  indices.forEach((index, rank) => { ranks[index - first] = rank; });
  return items.map(item => {
    const a = characterIndex(bidi.starts, item.start);
    const b = characterIndex(bidi.starts, item.end) - 1;
    return {item, rank: Math.min(ranks[a - first], ranks[b - first])};
  }).sort((a, b) => a.rank - b.rank).map(entry => entry.item);
}
