import {DrawingError} from '../drawing/commands.js';
import {ColrFont} from './colr-font.js';
import {CblcFont} from './cblc-index.js';

/** Bounded OpenType COLRv0/CPAL and CBDT PNG extraction. Font bytes belong to OpenTypeFont. */
export class ColorFont {
  constructor(font, {maxGlyphs = 65536, maxLayers = 4096, maxImageBytes = 16777216} = {}) {
    limit(maxGlyphs, 65536, 'Color glyph');
    limit(maxLayers, 65536, 'Color layer');
    limit(maxImageBytes, 67108864, 'Color image byte');
    if (!(font?.tables instanceof Map) || !Number.isInteger(font.glyphCount)
      || font.glyphCount < 1 || font.glyphCount > maxGlyphs) {
      throw new DrawingError('SFRENDER140', 'Invalid color-font glyph budget');
    }
    this.glyphCount = font.glyphCount;
    this.outlines = font.tables.has('COLR') ? new ColrFont(font, {maxGlyphs, maxLayers}) : null;
    this.bitmaps = font.tables.has('CBLC') || font.tables.has('CBDT')
      ? new CblcFont(font, {maxGlyphs, maxImageBytes}) : null;
    this.hasColor = !!(this.outlines?.hasColor || this.bitmaps?.hasColor);
    if (!this.hasColor && (font.tables.has('sbix') || font.tables.has('SVG '))) {
      throw new DrawingError('SFRENDER146', 'This color-font profile supports COLRv0/CPAL and CBDT PNG tables');
    }
  }

  layers(glyphId, palette = 0) {
    this.glyph(glyphId);
    return this.outlines?.layers(glyphId, palette) ?? null;
  }

  bitmap(glyphId, ppem) {
    this.glyph(glyphId);
    if (typeof ppem !== 'number' || !Number.isFinite(ppem) || ppem <= 0 || ppem > 1048576) {
      throw new DrawingError('SFRENDER140', 'Bitmap ppem must be positive and bounded');
    }
    return this.bitmaps?.bitmap(glyphId, ppem) ?? null;
  }

  glyph(glyphId) {
    if (!Number.isInteger(glyphId) || glyphId < 0 || glyphId >= this.glyphCount) {
      throw new DrawingError('SFRENDER140', 'Color glyph ID lies outside the font');
    }
  }
}

function limit(value, maximum, label) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new DrawingError('SFRENDER140', `${label} limit is invalid`);
  }
}
