import {DrawingError, finite} from '../drawing/commands.js';
import {parsePath} from '../geometry/path-markup.js';
import {ColorFont} from './color-fonts.js';

function extentBounds(extent, scale) {
  if (!extent) return {x: 0, y: 0, width: 0, height: 0};
  const left = Math.min(extent.xBearing, extent.xBearing + extent.width);
  const top = Math.min(-extent.yBearing, -extent.yBearing - extent.height);
  return {x: left * scale, y: top * scale, width: Math.abs(extent.width) * scale, height: Math.abs(extent.height) * scale};
}

function unionBounds(bounds) {
  const present = bounds.filter(value => value.width && value.height);
  if (!present.length) return {x: 0, y: 0, width: 0, height: 0};
  const x = Math.min(...present.map(value => value.x));
  const y = Math.min(...present.map(value => value.y));
  return {x, y, width: Math.max(...present.map(value => value.x + value.width)) - x,
    height: Math.max(...present.map(value => value.y + value.height)) - y};
}

/** Bounded face/glyph outline metadata; actual outlines and extents come from the loaded HarfBuzz font. */
export class FontGlyphs {
  constructor(fonts, {maxGlyphMetadata = 8192, maxPathBytes = 16777216} = {}) {
    if (!Number.isSafeInteger(maxGlyphMetadata) || maxGlyphMetadata < 1 || maxGlyphMetadata > 100000
      || !Number.isSafeInteger(maxPathBytes) || maxPathBytes < 1 || maxPathBytes > 67108864) {
      throw new DrawingError('SFRENDER142', 'Invalid glyph metadata cache budget');
    }
    this.fonts = fonts;
    this.maxEntries = maxGlyphMetadata;
    this.maxBytes = maxPathBytes;
    this.bytes = 0;
    this.entries = new Map();
    this.colors = new Map();
    this.bitmaps = new Map();
  }
  font(glyph) {
    const font = this.fonts.get(glyph.fontId);
    finite(glyph.fontSize, 'glyph font size', 1, 512);
    if (!Number.isInteger(glyph.glyphId) || glyph.glyphId < 0 || glyph.glyphId >= font.face.data.glyphCount) {
      throw new DrawingError('SFRENDER144', 'Glyph index is outside the loaded font');
    }
    return font;
  }
  colorFont(font) {
    let color = this.colors.get(font.face.id);
    if (!color) {
      color = new ColorFont(font.face.data);
      this.colors.set(font.face.id, color);
    }
    return color;
  }
  get(glyph) {
    const font = this.font(glyph);
    const key = `${glyph.fontId}:${glyph.glyphId}`;
    let entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.entries.set(key, entry); return entry; }
    const path = font.font.glyphToPath(glyph.glyphId);
    const bytes = path.length * 2;
    if (bytes > this.maxBytes || path.length > 1000000) throw new DrawingError('SFRENDER144', 'Glyph outline exceeds path budget');
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).bytes;
      this.entries.delete(oldest);
    }
    entry = {path, bytes, font, extent: font.font.glyphExtents(glyph.glyphId), geometry: null};
    this.entries.set(key, entry);
    this.bytes += bytes;
    return entry;
  }
  path(glyph) {
    const entry = this.get(glyph);
    return {path: entry.path, scale: glyph.fontSize / entry.font.unitsPerEm, fontId: glyph.fontId};
  }
  geometry(glyph) {
    const entry = this.get(glyph);
    if (entry.path && !entry.geometry) entry.geometry = parsePath(entry.path, {maxCharacters: 1000000, maxSegments: 100000});
    return entry.geometry;
  }
  layers(glyph) {
    const font = this.font(glyph);
    const layers = this.colorFont(font).layers(glyph.glyphId, glyph.palette ?? 0);
    if (!layers?.length) return null;
    return layers.map(layer => ({...this.path({...glyph, glyphId: layer.glyphId}), glyphId: layer.glyphId,
      color: layer.color?.map(channel => channel / 255) ?? null}));
  }
  bitmap(glyph, dpr = 1) {
    const font = this.font(glyph);
    const ppem = Math.max(1, Math.ceil(glyph.fontSize * dpr));
    const key = `${font.face.id}:${glyph.glyphId}:${ppem}`;
    if (this.bitmaps.has(key)) return this.bitmaps.get(key);
    const bitmap = this.colorFont(font).bitmap(glyph.glyphId, ppem);
    if (this.bitmaps.size >= this.maxEntries) this.bitmaps.delete(this.bitmaps.keys().next().value);
    const value = bitmap ? {...bitmap, key: `${font.face.id}:${glyph.glyphId}:${bitmap.ppemX}:${bitmap.ppemY}`} : null;
    this.bitmaps.set(key, value);
    return value;
  }
  bounds(glyph) {
    const font = this.font(glyph);
    const scale = glyph.fontSize / font.unitsPerEm;
    const layers = this.colorFont(font).layers(glyph.glyphId, glyph.palette ?? 0);
    if (layers?.length) return unionBounds(layers.map(layer => extentBounds(this.get({...glyph, glyphId: layer.glyphId}).extent, scale)));
    const bitmap = this.bitmap(glyph);
    if (bitmap) return {x: bitmap.bearingX * glyph.fontSize / bitmap.ppemX,
      y: -bitmap.bearingY * glyph.fontSize / bitmap.ppemY,
      width: bitmap.width * glyph.fontSize / bitmap.ppemX, height: bitmap.height * glyph.fontSize / bitmap.ppemY};
    return extentBounds(this.get(glyph).extent, scale);
  }
  dispose() {
    this.entries.clear();
    this.colors.clear();
    this.bitmaps.clear();
    this.bytes = 0;
  }
}
