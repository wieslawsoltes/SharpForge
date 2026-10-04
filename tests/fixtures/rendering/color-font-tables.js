import {deflateSync} from 'node:zlib';
import {OpenTypeFont} from '../../../packages/rendering/src/text/opentype.js';

export function colorFontTables({strikes = [], colr = null, cpal = null, glyphCount = 16, edit} = {}) {
  const tables = new Map();
  const head = bytes(54); head.u16(18, 1000);
  const maxp = bytes(6); maxp.u16(4, glyphCount);
  const hhea = bytes(10); hhea.u16(4, 800); hhea.u16(6, 0xff38);
  tables.set('head', head.data); tables.set('maxp', maxp.data); tables.set('hhea', hhea.data);
  if (strikes.length) {
    const images = [Uint8Array.of(0, 3, 0, 0)];
    let imageOffset = 4, listOffset = 8 + strikes.length * 48;
    const records = [], lists = [];
    for (const options of strikes) {
      const strike = makeStrike(options, imageOffset);
      const record = bytes(48);
      record.u32(0, listOffset); record.u32(4, strike.list.length); record.u32(8, 1);
      record.u16(40, strike.first); record.u16(42, strike.last);
      record.u8(44, options.ppemX ?? options.ppem ?? 16); record.u8(45, options.ppemY ?? options.ppem ?? 16);
      record.u8(46, 32); record.u8(47, options.flags ?? 1);
      records.push(record.data); lists.push(strike.list); images.push(strike.images);
      imageOffset += strike.images.length; listOffset += strike.list.length;
    }
    const header = bytes(8); header.u16(0, 3); header.u32(4, strikes.length);
    tables.set('CBLC', join([header.data, ...records, ...lists]));
    tables.set('CBDT', join(images));
  }
  if (colr) tables.set('COLR', makeColr(colr));
  if (cpal) tables.set('CPAL', makeCpal(cpal));
  edit?.(tables);
  const header = bytes(12 + tables.size * 16); header.u32(0, 0x10000); header.u16(4, tables.size);
  let offset = header.data.length, index = 0;
  const bodies = [];
  for (const [tag, data] of tables) {
    const at = 12 + index++ * 16;
    for (let letter = 0; letter < 4; letter++) header.u8(at + letter, tag.charCodeAt(letter));
    header.u32(at + 8, offset); header.u32(at + 12, data.length);
    const padded = new Uint8Array(align(data.length)); padded.set(data);
    bodies.push(padded); offset += padded.length;
  }
  return new OpenTypeFont(join([header.data, ...bodies]));
}

function makeStrike(options, imageBase) {
  const format = options.format ?? 1, imageFormat = options.imageFormat ?? 17;
  const ids = options.ids ?? [1], metrics = options.metrics ?? {width: 2, height: 1, bearingX: -3, bearingY: 4, advance: 7};
  const first = options.first ?? ids[0], last = options.last ?? ids.at(-1);
  const sparse = format === 4 || format === 5;
  const glyphs = sparse ? ids : Array.from({length: last - first + 1}, (_, index) => first + index);
  const offsets = [0], records = [];
  for (const id of glyphs) {
    const image = ids.includes(id) ? makeImage(imageFormat, metrics, options.png ?? glyphPng(metrics.width, metrics.height)) : new Uint8Array();
    records.push(image); offsets.push(offsets.at(-1) + image.length);
  }
  const lengths = {1: 8 + offsets.length * 4, 2: 20, 3: 8 + offsets.length * 2,
    4: 12 + offsets.length * 4, 5: 24 + ids.length * 2};
  const subtable = bytes(align(lengths[format]));
  subtable.u16(0, format); subtable.u16(2, imageFormat); subtable.u32(4, imageBase);
  if (format === 1 || format === 3) offsets.forEach((offset, index) => {
    if (format === 1) subtable.u32(8 + index * 4, offset);
    else subtable.u16(8 + index * 2, offset);
  });
  else if (format === 4) {
    subtable.u32(8, ids.length);
    offsets.forEach((offset, index) => { subtable.u16(12 + index * 4, ids[index] ?? 0xffff); subtable.u16(14 + index * 4, offset); });
  } else {
    subtable.u32(8, records[0].length); putMetrics(subtable, 12, metrics, true);
    if (format === 5) { subtable.u32(20, ids.length); ids.forEach((id, index) => subtable.u16(24 + index * 2, id)); }
  }
  const list = bytes(8); list.u16(0, first); list.u16(2, last); list.u32(4, 8);
  return {first, last, list: join([list.data, subtable.data]), images: join(records)};
}

function makeImage(format, metrics, png) {
  const metricSize = format === 17 ? 5 : format === 18 ? 8 : 0;
  const header = bytes(metricSize + 4);
  if (metricSize) putMetrics(header, 0, metrics, metricSize === 8);
  header.u32(metricSize, png.length);
  return join([header.data, png]);
}

function putMetrics(target, offset, metrics, big) {
  [metrics.height, metrics.width, metrics.bearingX, metrics.bearingY, metrics.advance].forEach((value, index) => target.u8(offset + index, value));
  if (big) { target.u8(offset + 5, -1); target.u8(offset + 6, 2); target.u8(offset + 7, 9); }
}

export function makeColr({version = 0, bases = [{glyphId: 1, first: 0, count: 2}], layers = [[2, 0], [3, 0xffff]]} = {}) {
  const table = bytes(14 + bases.length * 6 + layers.length * 4);
  table.u16(0, version); table.u16(2, bases.length); table.u32(4, 14); table.u32(8, 14 + bases.length * 6);
  table.u16(12, layers.length);
  bases.forEach((base, index) => {
    const at = 14 + index * 6;
    table.u16(at, base.glyphId); table.u16(at + 2, base.first); table.u16(at + 4, base.count);
  });
  layers.forEach(([glyph, color], index) => {
    const at = 14 + bases.length * 6 + index * 4;
    table.u16(at, glyph); table.u16(at + 2, color);
  });
  return table.data;
}

export function makeCpal({version = 0, entries = 2, starts = [0, 2], colors = [[1, 2, 3, 255], [5, 6, 7, 128],
  [10, 20, 30, 0], [50, 60, 70, 64]]} = {}) {
  const headerSize = 12 + starts.length * 2 + (version === 1 ? 12 : 0);
  const table = bytes(headerSize + colors.length * 4);
  table.u16(0, version); table.u16(2, entries); table.u16(4, starts.length); table.u16(6, colors.length); table.u32(8, headerSize);
  starts.forEach((first, index) => table.u16(12 + index * 2, first));
  colors.forEach(([red, green, blue, alpha], index) => {
    [blue, green, red, alpha].forEach((value, channel) => table.u8(headerSize + index * 4 + channel, value));
  });
  return table.data;
}

export function glyphPng(width = 2, height = 1, {extra = [], colorType = 6} = {}) {
  const header = bytes(13); header.u32(0, width); header.u32(4, height); header.u8(8, 8); header.u8(9, colorType);
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let row = 0; row < height; row++) for (let pixel = 0; pixel < width; pixel++) raw[row * (1 + width * 4) + 4 + pixel * 4] = 255;
  return join([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header.data), ...extra,
    chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

export function chunk(tag, data) {
  const result = bytes(data.length + 12); result.u32(0, data.length);
  for (let index = 0; index < 4; index++) result.u8(4 + index, tag.charCodeAt(index));
  result.data.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of result.data.subarray(4, 8 + data.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  result.u32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return result.data;
}

export function bytes(length) {
  const data = new Uint8Array(length), view = new DataView(data.buffer);
  return {data, u8: (at, value) => view.setUint8(at, value), u16: (at, value) => view.setUint16(at, value),
    u32: (at, value) => view.setUint32(at, value)};
}
function align(length) { return (length + 3) & ~3; }
function join(parts) {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
