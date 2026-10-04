import {DrawingError} from '../drawing/commands.js';
import {readColorBitmap, bitmapMetrics} from './cbdt-image.js';

/** All five CBLC index forms, with one bounded descriptor per present glyph/strike. */
export class CblcFont {
  constructor(font, {maxGlyphs, maxImageBytes}) {
    const locations = font.tables.get('CBLC'), images = font.tables.get('CBDT');
    if (!locations || !images) corrupt('CBDT and CBLC must be present together');
    if (locations.u16(0) !== 3 || locations.u16(2) !== 0 || images.u16(0) !== 3 || images.u16(2) !== 0) {
      unsupported('Only CBDT/CBLC version 3.0 is supported');
    }
    const count = locations.u32(4);
    if (count > 256) corrupt('Color bitmap strike count exceeds its budget');
    locations.range(8, count * 48);
    const state = {font, images, remaining: maxGlyphs, maxImageBytes, metadataEnd: 8 + count * 48};
    this.strikes = [];
    for (let index = 0; index < count; index++) this.strikes.push(readStrike(locations, 8 + index * 48, state));
    this.strikes.sort((left, right) => left.ppemY - right.ppemY || left.ppemX - right.ppemX);
    this.images = images;
    this.maxImageBytes = maxImageBytes;
    this.hasColor = this.strikes.some(strike => strike.glyphs.size > 0);
  }

  bitmap(glyphId, ppem) {
    // A strike may have holes. Choose among strikes that actually contain this glyph.
    let selected = null;
    for (const strike of this.strikes) {
      if (!strike.glyphs.has(glyphId)) continue;
      selected = strike;
      if (strike.ppemY >= ppem) break;
    }
    if (!selected) return null;
    if (!selected.cache.has(glyphId)) {
      const record = selected.glyphs.get(glyphId);
      const bitmap = readColorBitmap(this.images.sub(record.offset, record.length), record, this.maxImageBytes);
      selected.cache.set(glyphId, Object.freeze({...bitmap, ppemX: selected.ppemX, ppemY: selected.ppemY}));
    }
    return selected.cache.get(glyphId);
  }
}

function readStrike(table, at, state) {
  const start = table.u16(at + 40), end = table.u16(at + 42), count = table.u32(at + 8);
  const ppemX = table.u8(at + 44), ppemY = table.u8(at + 45), bitDepth = table.u8(at + 46), flags = table.u8(at + 47);
  if (start > end || end >= state.font.glyphCount || !ppemX || !ppemY || ![1, 2, 4, 8, 32].includes(bitDepth)
    || ![1, 2].includes(flags) || table.u32(at + 12) !== 0 || count > state.remaining) corrupt('Invalid color bitmap strike');
  const listOffset = table.u32(at), listSize = table.u32(at + 4);
  if (listOffset < state.metadataEnd || listOffset % 4) corrupt('CBLC index list overlaps metadata or is unaligned');
  const list = table.sub(listOffset, listSize);
  list.range(0, count * 8);
  const glyphs = new Map();
  let previous = start - 1;
  for (let index = 0; index < count; index++) {
    const cursor = index * 8, first = list.u16(cursor), last = list.u16(cursor + 2), offset = list.u32(cursor + 4);
    if (first <= previous || first < start || last < first || last > end || offset < count * 8 || offset % 4) corrupt('Invalid CBLC glyph range');
    previous = last;
    readIndex(list.sub(offset), {first, last, flags, glyphs}, state);
  }
  return {ppemX, ppemY, glyphs, cache: new Map()};
}

function readIndex(table, range, state) {
  const format = table.u16(0), imageFormat = table.u16(2), base = table.u32(4);
  if (format < 1 || format > 5) unsupported('Unsupported CBLC index format');
  if (![17, 18, 19].includes(imageFormat)) unsupported('Only CBDT PNG image formats 17, 18 and 19 are supported');
  if (imageFormat === 19 && format !== 2 && format !== 5) corrupt('CBDT format 19 requires shared CBLC metrics');
  if (imageFormat === 17 && range.flags !== 1) unsupported('Vertical-only small bitmap metrics are outside this horizontal profile');
  if (base < 4) corrupt('CBDT image data overlaps the version header');
  state.images.range(base, 0);
  const context = {table, range, state, imageFormat, base};
  if (format === 1 || format === 3) readOffsets(context, format === 1 ? 4 : 2);
  else if (format === 4) readSparseOffsets(context);
  else readFixed(context, format);
}

function readOffsets(context, width) {
  const {table, range} = context, count = range.last - range.first + 1;
  table.range(8, (count + 1) * width);
  const read = offset => width === 4 ? table.u32(offset) : table.u16(offset);
  let previous = read(8);
  for (let index = 0; index < count; index++) {
    const next = read(8 + (index + 1) * width);
    addGlyph(context, {glyphId: range.first + index, offset: previous, length: next - previous});
    previous = next;
  }
}

function readSparseOffsets(context) {
  const {table, range, state} = context, count = table.u32(8);
  if (count > state.remaining || count > range.last - range.first + 1) corrupt('Sparse CBLC index exceeds its budget');
  table.range(12, (count + 1) * 4);
  let previous = range.first - 1;
  for (let index = 0; index < count; index++) {
    const at = 12 + index * 4, glyphId = table.u16(at), offset = table.u16(at + 2), next = table.u16(at + 6);
    if (glyphId <= previous || glyphId < range.first || glyphId > range.last) corrupt('Unsorted sparse CBLC glyph IDs');
    addGlyph(context, {glyphId, offset, length: next - offset});
    previous = glyphId;
  }
}

function readFixed(context, format) {
  const {table, range, state} = context, size = table.u32(8), metrics = bitmapMetrics(table, 12, true);
  if (!size || size > state.maxImageBytes + 12) corrupt('Fixed CBDT image size exceeds its budget');
  const count = format === 2 ? range.last - range.first + 1 : table.u32(20);
  if (count > state.remaining || count > range.last - range.first + 1) corrupt('Fixed CBLC index exceeds its budget');
  if (format === 5) table.range(24, count * 2);
  let previous = range.first - 1;
  for (let index = 0; index < count; index++) {
    const glyphId = format === 2 ? range.first + index : table.u16(24 + index * 2);
    if (glyphId <= previous || glyphId < range.first || glyphId > range.last) corrupt('Unsorted fixed CBLC glyph IDs');
    addGlyph(context, {glyphId, offset: index * size, length: size, metrics});
    previous = glyphId;
  }
}

function addGlyph(context, item) {
  const {state, range, base, imageFormat} = context;
  if (item.length < 0 || item.length > state.maxImageBytes + 12) corrupt('Invalid CBDT image extent');
  state.images.range(base + item.offset, item.length);
  if (!item.length) return;
  if (--state.remaining < 0) corrupt('Color bitmap glyph records exceed their budget');
  range.glyphs.set(item.glyphId, Object.freeze({...item, offset: base + item.offset, imageFormat}));
}

function corrupt(message) { throw new DrawingError('SFRENDER140', message); }
function unsupported(message) { throw new DrawingError('SFRENDER146', message); }
