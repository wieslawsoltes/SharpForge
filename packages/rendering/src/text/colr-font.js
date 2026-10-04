import {DrawingError} from '../drawing/commands.js';

/** COLRv0 layer order and CPAL's exact, unpremultiplied RGBA bytes. */
export class ColrFont {
  constructor(font, {maxGlyphs, maxLayers}) {
    const table = font.tables.get('COLR');
    if (table.u16(0) !== 0) throw new DrawingError('SFRENDER146', 'Only COLR version 0 is supported');
    table.range(0, 14);
    this.records = new Map();
    this.layersTable = [];
    this.palette = font.tables.has('CPAL') ? readPalette(font.tables.get('CPAL')) : null;
    // OpenType specifies that COLR is ignored when its required CPAL table is absent.
    if (!this.palette) { this.hasColor = false; return; }
    const count = table.u16(2), layerCount = table.u16(12);
    const baseOffset = table.u32(4), layerOffset = table.u32(8);
    if (count > maxGlyphs || layerCount > maxLayers) corrupt('Color layer metadata exceeds its budget');
    requireArray(table, baseOffset, count * 6, 14);
    requireArray(table, layerOffset, layerCount * 4, 14);
    let previous = -1;
    for (let index = 0; index < count; index++) {
      const at = baseOffset + index * 6;
      const glyph = table.u16(at), first = table.u16(at + 2), length = table.u16(at + 4);
      if (glyph <= previous || glyph >= font.glyphCount || first + length > layerCount) corrupt('Invalid COLR base glyph record');
      this.records.set(glyph, {first, length});
      previous = glyph;
    }
    for (let index = 0; index < layerCount; index++) {
      const at = layerOffset + index * 4, glyphId = table.u16(at), color = table.u16(at + 2);
      if (glyphId >= font.glyphCount || color !== 0xffff && color >= this.palette.entries) corrupt('Invalid COLR layer record');
      this.layersTable.push(Object.freeze({glyphId, color}));
    }
    this.hasColor = count > 0;
  }

  layers(glyphId, palette = 0) {
    if (!this.palette) return null;
    if (!Number.isInteger(palette) || palette < 0 || palette >= this.palette.starts.length) corrupt('Unknown CPAL palette');
    const record = this.records.get(glyphId);
    if (!record) return null;
    return Object.freeze(this.layersTable.slice(record.first, record.first + record.length).map(layer => Object.freeze({
      glyphId: layer.glyphId,
      color: layer.color === 0xffff ? null : this.palette.colors[this.palette.starts[palette] + layer.color]
    })));
  }
}

function readPalette(table) {
  const version = table.u16(0);
  if (version > 1) throw new DrawingError('SFRENDER146', 'Only CPAL versions 0 and 1 are supported');
  table.range(0, 12);
  const entries = table.u16(2), count = table.u16(4), colorCount = table.u16(6), offset = table.u32(8);
  if (!entries || !count || !colorCount) corrupt('A CPAL palette must contain colors');
  const headerEnd = 12 + count * 2 + (version === 1 ? 12 : 0);
  table.range(0, headerEnd);
  requireArray(table, offset, colorCount * 4, headerEnd);
  const starts = [];
  for (let index = 0; index < count; index++) {
    const first = table.u16(12 + index * 2);
    if (first + entries > colorCount) corrupt('CPAL palette extends beyond the color records');
    starts.push(first);
  }
  if (version === 1) {
    const at = 12 + count * 2;
    for (const [relative, size] of [[0, count * 4], [4, count * 2], [8, entries * 2]]) {
      const arrayOffset = table.u32(at + relative);
      if (arrayOffset) requireArray(table, arrayOffset, size, headerEnd);
    }
  }
  const colors = [];
  for (let index = 0; index < colorCount; index++) {
    const at = offset + index * 4;
    colors.push(Object.freeze([table.u8(at + 2), table.u8(at + 1), table.u8(at), table.u8(at + 3)]));
  }
  return {entries, starts, colors};
}

function requireArray(table, offset, length, minimum) {
  if (length && offset < minimum) corrupt('Color table array overlaps its header');
  table.range(offset, length);
}

function corrupt(message) { throw new DrawingError('SFRENDER140', message); }
