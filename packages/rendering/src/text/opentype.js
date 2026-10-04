import {DrawingError} from '../drawing/commands.js';

/** Bounds-checked read-only OpenType view. Font bytes remain owned by the text provider. */
export class FontData {
  constructor(bytes, offset = 0, length = bytes.byteLength - offset) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.byteLength) {
      throw new DrawingError('SFRENDER140', 'OpenType table lies outside the supplied font');
    }
    this.bytes = bytes;
    this.offset = offset;
    this.length = length;
    this.view = new DataView(bytes.buffer, bytes.byteOffset + offset, length);
  }
  range(offset, length) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.length) {
      throw new DrawingError('SFRENDER140', 'Truncated or invalid OpenType data', offset);
    }
    return offset;
  }
  u8(offset) { return this.view.getUint8(this.range(offset, 1)); }
  i8(offset) { return this.view.getInt8(this.range(offset, 1)); }
  u16(offset) { return this.view.getUint16(this.range(offset, 2)); }
  i16(offset) { return this.view.getInt16(this.range(offset, 2)); }
  u32(offset) { return this.view.getUint32(this.range(offset, 4)); }
  fixed(offset) { return this.view.getInt32(this.range(offset, 4)) / 65536; }
  tag(offset) { return String.fromCharCode(this.u8(offset), this.u8(offset + 1), this.u8(offset + 2), this.u8(offset + 3)); }
  sub(offset, length = this.length - offset) {
    this.range(offset, length);
    return new FontData(this.bytes, this.offset + offset, length);
  }
  copy(offset, length) {
    this.range(offset, length);
    return this.bytes.slice(this.offset + offset, this.offset + offset + length);
  }
}

/** Parse only directory/metric/variation metadata; glyph shaping and outlines come from HarfBuzz. */
export class OpenTypeFont {
  constructor(input, {index = 0, maxBytes = 67108864, maxTables = 256} = {}) {
    if (!(input instanceof Uint8Array || input instanceof ArrayBuffer) || input.byteLength < 12 || input.byteLength > maxBytes) {
      throw new DrawingError('SFRENDER140', 'Invalid font byte budget');
    }
    // Buffer.slice() aliases its slab; normalize every byte view to an exact, independently owned ArrayBuffer.
    const bytes = input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input.slice(0));
    const file = new FontData(bytes);
    let offset = 0;
    if (file.tag(0) === 'ttcf') {
      const count = file.u32(8);
      if (!Number.isSafeInteger(index) || index < 0 || index >= count || count > 256) throw new DrawingError('SFRENDER140', 'Invalid collection face');
      offset = file.u32(12 + index * 4);
    } else if (index !== 0) throw new DrawingError('SFRENDER140', 'Single-face font index must be zero');
    const directory = file.sub(offset);
    if (![0x00010000, 0x4f54544f, 0x74727565].includes(directory.u32(0))) throw new DrawingError('SFRENDER140', 'Expected an OpenType sfnt font');
    const count = directory.u16(4);
    if (!count || count > maxTables) throw new DrawingError('SFRENDER140', 'Font table count exceeds budget');
    directory.range(12, count * 16);
    this.bytes = bytes;
    this.index = index;
    this.tables = new Map();
    for (let table = 0; table < count; table++) {
      const at = 12 + table * 16;
      const tag = directory.tag(at);
      if (this.tables.has(tag)) throw new DrawingError('SFRENDER140', 'Duplicate OpenType table');
      this.tables.set(tag, file.sub(directory.u32(at + 8), directory.u32(at + 12)));
    }
    this.unitsPerEm = this.required('head').u16(18);
    this.glyphCount = this.required('maxp').u16(4);
    if (this.unitsPerEm < 16 || this.unitsPerEm > 16384 || !this.glyphCount) throw new DrawingError('SFRENDER140', 'Invalid font metrics');
    this.axes = variationAxes(this.tables.get('fvar'));
    this.metrics = fontMetrics(this);
  }
  required(tag) {
    const table = this.tables.get(tag);
    if (!table) throw new DrawingError('SFRENDER140', `Font is missing ${tag}`);
    return table;
  }
}

function variationAxes(table) {
  if (!table) return [];
  const start = table.u16(4);
  const count = table.u16(8);
  const size = table.u16(10);
  if (count > 64 || size < 20) throw new DrawingError('SFRENDER140', 'Invalid font variation axes');
  table.range(start, count * size);
  return Array.from({length: count}, (_, index) => {
    const at = start + index * size;
    const axis = {tag: table.tag(at), minimum: table.fixed(at + 4), default: table.fixed(at + 8), maximum: table.fixed(at + 12)};
    if (axis.minimum > axis.default || axis.default > axis.maximum) throw new DrawingError('SFRENDER140', 'Invalid font axis bounds');
    return axis;
  });
}

function fontMetrics(font) {
  const horizontal = font.required('hhea');
  const post = font.tables.get('post');
  const os2 = font.tables.get('OS/2');
  return {ascent: horizontal.i16(4), descent: horizontal.i16(6), lineGap: horizontal.i16(8),
    underlinePosition: post?.i16(8) ?? -font.unitsPerEm / 10,
    underlineThickness: post?.i16(10) ?? font.unitsPerEm / 16,
    strikePosition: os2?.i16(28) ?? font.unitsPerEm / 3,
    strikeThickness: os2?.i16(26) ?? font.unitsPerEm / 16};
}
