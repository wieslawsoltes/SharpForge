import {DrawingError, finite} from '../drawing/commands.js';
import {fontFeatures} from './harfbuzz-shaper.js';
import {segmentGraphemes} from './unicode.js';
import {textBidi, lineBidiTail} from './bidi.js';

export function textOptions(options = {}) {
  const width = options.width == null || options.width === Infinity ? Infinity : finite(options.width, 'text width', 0, 100000);
  const fontSize = finite(options.fontSize ?? 14, 'font size', 1, 512);
  const fontWeight = finite(options.fontWeight?.Weight ?? options.fontWeight ?? 400, 'font weight', 1, 1000);
  const fontFamily = String(options.fontFamily?.Source ?? options.fontFamily ?? 'sans-serif');
  const fontStyle = options.fontStyle ?? 'normal';
  if (fontFamily.length > 4096 || !['normal', 'italic', 'oblique'].includes(fontStyle)) {
    throw new DrawingError('SFRENDER143', 'Invalid font family or style');
  }
  const lineHeight = options.lineHeight ? finite(options.lineHeight, 'line height', 0.01, 4096) : 0;
  const maxLines = options.maxLines ?? 0;
  if (!Number.isSafeInteger(maxLines) || maxLines < 0 || maxLines > 100000) throw new DrawingError('SFRENDER082', 'Invalid maximum line count');
  const direction = options.direction ?? 'auto';
  const alignment = options.alignment ?? 'left';
  const wrapping = options.wrapping === 0 ? 'nowrap' : options.wrapping === 2 ? 'wholewords' : options.wrapping ?? 'wrap';
  if (!['auto', 'ltr', 'rtl'].includes(direction) || !['left', 'right', 'center', 'start', 'end', 'justify'].includes(alignment)
    || !['wrap', 'nowrap', 'wholewords'].includes(wrapping)) throw new DrawingError('SFRENDER143', 'Invalid text direction, alignment, or wrapping');
  if (options.language != null && !/^[A-Za-z0-9-]{1,128}$/.test(options.language)) throw new DrawingError('SFRENDER143', 'Invalid text language');
  if (options.variations != null && (typeof options.variations !== 'object' || Array.isArray(options.variations)
    || Object.keys(options.variations).length > 64 || Object.entries(options.variations)
      .some(([tag, value]) => !/^[A-Za-z0-9]{4}$/.test(tag) || !Number.isFinite(value)))) {
    throw new DrawingError('SFRENDER143', 'Font variations require finite four-character axis values');
  }
  return {...options, width, fontSize, fontWeight, fontFamily, fontStyle, lineHeight, maxLines, direction, alignment, wrapping,
    letterSpacing: finite(options.letterSpacing ?? 0, 'letter spacing', -512, 512),
    tabSize: finite(options.tabSize ?? 8, 'tab size in spaces', 1, 256)};
}

function textSpans(text, options) {
  const input = options.runs?.length ? options.runs : [{start: 0, end: text.length, style: {}}];
  const spans = [];
  let position = 0;
  for (const span of input) {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start !== position
      || span.end < span.start || span.end > text.length || spans.length > 100000) throw new DrawingError('SFRENDER143', 'Invalid text style spans');
    const style = textOptions({...options, ...span.style, runs: undefined});
    spans.push({...span, style, features: fontFeatures(style.features, style.letterSpacing)});
    position = span.end;
  }
  if (position !== text.length) throw new DrawingError('SFRENDER143', 'Text spans must cover the whole input');
  return spans;
}

export function hardLineBreak(cluster) {
  return cluster.characters.some(character => [10, 11, 12, 13, 0x85, 0x2028, 0x2029].includes(character.codePoint));
}

/** Itemize by exact face/variation, font size, language, script and bidi level. Paint changes preserve shaping context. */
export function prepareText(text, options, fonts, {maxClusters, signal} = {}) {
  const clusters = segmentGraphemes(text, {maxClusters, signal});
  const bidi = textBidi(text, options.direction);
  const spans = textSpans(text, options);
  const items = [];
  let spanIndex = 0;
  for (const cluster of clusters) {
    while (spans[spanIndex + 1] && spans[spanIndex].end <= cluster.start) spanIndex++;
    const span = spans[spanIndex];
    cluster.style = span.style;
    cluster.rtl = Boolean(bidi.levels[cluster.start] & 1);
    cluster.level = bidi.levels[cluster.start];
    if (hardLineBreak(cluster)) continue;
    const font = fonts.select(span.style, cluster);
    cluster.font = font;
    const tab = cluster.characters.length === 1 && cluster.characters[0].codePoint === 9;
    if (span.end < cluster.end && spans[spanIndex + 1]) {
      const next = spans[spanIndex + 1];
      const nextFont = fonts.select(next.style, cluster);
      if (font.id !== nextFont.id || span.style.fontSize !== next.style.fontSize || span.features !== next.features) {
        throw new DrawingError('SFRENDER143', 'A font style span must not divide a Unicode grapheme', span.end);
      }
    }
    const previous = items.at(-1);
    if (previous && !tab && !previous.tab && previous.end === cluster.start && previous.font.id === font.id && previous.script === cluster.script
      && previous.level === cluster.level && previous.style.fontSize === span.style.fontSize && previous.features === span.features
      && previous.style.letterSpacing === span.style.letterSpacing && previous.style.language === span.style.language
      && previous.style.foreground === span.style.foreground && previous.style.underline === span.style.underline
      && previous.style.strikethrough === span.style.strikethrough) {
      previous.end = cluster.end;
      previous.clusters.push(cluster);
    } else {
      items.push({start: cluster.start, end: cluster.end, font, script: cluster.script, rtl: cluster.rtl, level: cluster.level,
        style: span.style, features: span.features, clusters: [cluster], tab});
    }
  }
  return {text, options, clusters, bidi, spans, items};
}

export function lowerBound(items, position, key = 'end') {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle][key] <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Shape a line with its own surrounding context; indexes remain original UTF-16 positions. */
export function shapeTextRange(prepared, shaper, start, end, signal) {
  const result = [];
  const first = lowerBound(prepared.items, start);
  const tail = lineBidiTail(prepared.bidi, start, end);
  let advance = 0;
  for (let index = first; index < prepared.items.length && prepared.items[index].start < end; index++) {
    const item = prepared.items[index];
    const left = Math.max(start, item.start);
    const right = Math.min(end, item.end);
    const pieces = tail.start > left && tail.start < right ? [[left, tail.start], [tail.start, right]] : [[left, right]];
    for (const [a, b] of pieces) {
      const selected = {...item, start: a, end: b, ...(a >= tail.start ? {level: tail.level, rtl: Boolean(tail.level & 1)} : {})};
      const shaped = selected.tab ? shapeTab(selected, advance) : shaper.shape(selected, {start, end, signal});
      result.push(shaped);
      advance += shaped.width + shaped.style.letterSpacing;
    }
  }
  return {items: result, width: result.reduce((sum, item, index) => sum + item.width +
      (index + 1 < result.length ? item.style.letterSpacing : 0), 0),
    ascent: result.reduce((value, item) => Math.max(value, item.ascent), 0),
    descent: result.reduce((value, item) => Math.max(value, item.descent), 0),
    lineGap: result.reduce((value, item) => Math.max(value, item.lineGap), 0)};
}

/** Tabs are control advances to real font-space stops; they never become fabricated glyph IDs. */
function shapeTab(item, advance) {
  const scale = item.style.fontSize / item.font.unitsPerEm;
  const space = item.font.face.cmap.glyph(32);
  const stop = item.font.font.glyphHAdvance(space) * scale * item.style.tabSize;
  if (!space || !Number.isFinite(stop) || stop <= 0) throw new DrawingError('SFRENDER141', 'Tab layout needs a loaded font with a space advance');
  const width = (Math.floor(Math.max(0, advance) / stop) + 1) * stop - advance;
  return {...item, glyphs: [], width, scale,
    ascent: Math.max(0, item.font.metrics.ascender * scale), descent: Math.max(0, -item.font.metrics.descender * scale),
    lineGap: Math.max(0, item.font.metrics.lineGap * scale)};
}
