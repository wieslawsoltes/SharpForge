import {DrawingError} from '../drawing/commands.js';

/** Cache identity includes a loaded font-face version, glyph ID, DIP size, DPR, and physical subpixel buckets. */
export function glyphRasterKey(glyph, {dpr = 1, subpixelX = 0, subpixelY = 0, buckets = 4} = {}) {
  const font = glyph?.fontId;
  if (!(typeof font === 'string' && font.length && font.length <= 512 || Number.isSafeInteger(font) && font >= 0)
    || !Number.isInteger(glyph.glyphId) || glyph.glyphId < 0 || glyph.glyphId > 0xffffffff
    || !Number.isFinite(glyph.fontSize) || glyph.fontSize <= 0 || glyph.fontSize > 4096
    || !Number.isFinite(dpr) || dpr < 0.25 || dpr > 8
    || !Number.isInteger(buckets) || buckets < 1 || buckets > 16
    || ![subpixelX, subpixelY].every(value => Number.isFinite(value) && value >= 0 && value < 1)) {
    throw new DrawingError('SFRENDER131', 'Invalid numeric glyph identity, size, DPR or subpixel phase');
  }
  const x = Math.floor(subpixelX * buckets), y = Math.floor(subpixelY * buckets);
  return {key: '\u0001glyph:' + JSON.stringify([font, glyph.glyphId, glyph.fontSize, dpr, buckets, x, y]),
    dpr, subpixelX: x / buckets, subpixelY: y / buckets};
}

/** Raster providers return physical pixels plus their DIP rectangle relative to the already-positioned glyph origin. */
export function glyphRasterMetrics(image, maximum) {
  if (!image || image.then || ![image.width, image.height].every(value => Number.isInteger(value) && value >= 0 && value <= maximum)) {
    throw new DrawingError('SFRENDER132', 'Glyph rasterization must return a synchronous bounded image');
  }
  const bounds = image.logicalBounds;
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(value => Number.isFinite(value) && Math.abs(value) <= 1000000)
    || bounds.width < 0 || bounds.height < 0 || image.alphaMode !== 'premultiplied' || image.colorSpace !== 'srgb') {
    throw new DrawingError('SFRENDER132', 'Glyph raster requires premultiplied sRGB pixels and finite DIP bounds');
  }
  if ((!image.width || !image.height) && (bounds.width || bounds.height)) {
    throw new DrawingError('SFRENDER132', 'Empty glyph raster has nonempty bounds');
  }
  if (image.pending === true && (image.width || image.height)) {
    throw new DrawingError('SFRENDER132', 'Pending glyph raster must not expose incomplete pixels');
  }
  if (image.width && image.height && (!image.source || !bounds.width || !bounds.height)) {
    throw new DrawingError('SFRENDER132', 'Nonempty glyph raster has no source or bounds');
  }
  return Object.freeze({bounds: Object.freeze({x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height}),
    colorGlyph: image.colorGlyph === true});
}
