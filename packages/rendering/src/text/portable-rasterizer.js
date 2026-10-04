import {DrawingError, finite} from '../drawing/commands.js';
import {cssColor} from '../media/colors.js';
import {traceGeometry} from '../backends/paths.js';
import {FontGlyphs} from './font-glyphs.js';
import {DecodedGlyphs} from './decoded-glyphs.js';

function defaultCanvas(width, height) {
  if (typeof globalThis.OffscreenCanvas === 'function') return new globalThis.OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) throw new DrawingError('SFRENDER084', 'Glyph rasterization requires Canvas2D or an injected canvas factory');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function emptyRaster(colorGlyph = false, pending = false) {
  return {source: null, width: 0, height: 0, logicalWidth: 0, logicalHeight: 0,
    logicalBounds: {x: 0, y: 0, width: 0, height: 0}, alphaMode: 'premultiplied', colorSpace: 'srgb', colorGlyph, pending};
}

/** Rasterizes real HarfBuzz outlines or decoded OpenType color images; it never draws guessed Unicode characters. */
export class PortableGlyphRasterizer {
  constructor(fonts, {createCanvas = defaultCanvas, maxPixels = 16777216, ...options} = {}) {
    this.createCanvas = createCanvas;
    this.maxPixels = maxPixels;
    this.glyphs = new FontGlyphs(fonts, options);
    this.images = new DecodedGlyphs(options);
  }
  glyphPath(glyph) { return this.glyphs.path(glyph); }
  glyphBounds(glyph) { return this.glyphs.bounds(glyph); }
  glyphLayers(glyph) { return this.glyphs.layers(glyph); }
  requests(run) {
    const requests = [];
    const keys = new Set();
    let bytes = 0;
    for (const glyph of run.glyphs) {
      const bitmap = this.glyphs.bitmap(glyph);
      if (!bitmap || keys.has(bitmap.key)) continue;
      bytes += bitmap.width * bitmap.height * 4;
      if (bytes > this.images.maxBytes) throw new DrawingError('SFRENDER147', 'Visible color glyphs exceed the decoded image budget');
      keys.add(bitmap.key);
      requests.push(this.images.request(bitmap));
    }
    return requests;
  }
  schedule(run) { this.requests(run); }
  async prepare(run, signal) { await this.images.prepare(this.requests(run), signal); }
  draw(context, glyph, {fill = '#000000', dpr = 1, overrideColors = false, intrinsicOpacity = 1} = {}) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Glyph rasterizer is disposed');
    const layers = this.glyphs.layers(glyph);
    if (layers) {
      for (const layer of layers) {
        context.save();
        try {
          if (!overrideColors && layer.color) context.globalAlpha *= intrinsicOpacity;
          this.drawOutline(context, {...glyph, glyphId: layer.glyphId}, overrideColors || !layer.color ? fill : cssColor(layer.color));
        } finally { context.restore(); }
      }
      return true;
    }
    const bitmap = this.glyphs.bitmap(glyph, dpr);
    if (bitmap) {
      const entry = this.images.request(bitmap);
      if (!entry.source) return false;
      const xScale = glyph.fontSize / bitmap.ppemX;
      const yScale = glyph.fontSize / bitmap.ppemY;
      context.save();
      try {
        context.globalAlpha *= intrinsicOpacity;
        context.drawImage(entry.source, bitmap.bearingX * xScale, -bitmap.bearingY * yScale, bitmap.width * xScale, bitmap.height * yScale);
      } finally { context.restore(); }
      return true;
    }
    this.drawOutline(context, glyph, fill);
    return true;
  }
  drawOutline(context, glyph, fill) {
    const geometry = this.glyphs.geometry(glyph);
    if (!geometry) return;
    const scale = glyph.fontSize / this.glyphs.font(glyph).unitsPerEm;
    context.save();
    try {
      context.scale(scale, -scale);
      context.fillStyle = fill;
      traceGeometry(context, geometry);
      context.fill('nonzero');
    } finally { context.restore(); }
  }
  rasterize(glyph, {dpr = 1, subpixelX = 0, subpixelY = 0, color = '#ffffff'} = {}) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Glyph rasterizer is disposed');
    finite(dpr, 'glyph density', 0.25, 8);
    finite(subpixelX, 'glyph phase', 0, 1 - Number.EPSILON);
    finite(subpixelY, 'glyph phase', 0, 1 - Number.EPSILON);
    const bitmap = this.glyphs.bitmap(glyph, dpr);
    const colorGlyph = Boolean(bitmap || this.glyphs.layers(glyph));
    if (bitmap && !this.images.request(bitmap).source) return emptyRaster(true, true);
    const bounds = bitmap ? {x: bitmap.bearingX * glyph.fontSize / bitmap.ppemX,
      y: -bitmap.bearingY * glyph.fontSize / bitmap.ppemY,
      width: bitmap.width * glyph.fontSize / bitmap.ppemX, height: bitmap.height * glyph.fontSize / bitmap.ppemY} : this.glyphBounds(glyph);
    if (!bounds.width || !bounds.height) return emptyRaster(colorGlyph);
    const left = Math.floor(bounds.x * dpr + subpixelX) - 1;
    const top = Math.floor(bounds.y * dpr + subpixelY) - 1;
    const width = Math.ceil((bounds.x + bounds.width) * dpr + subpixelX) + 1 - left;
    const height = Math.ceil((bounds.y + bounds.height) * dpr + subpixelY) + 1 - top;
    if (width > 16384 || height > 16384 || width * height > this.maxPixels) throw new DrawingError('SFRENDER082', 'Glyph raster pixel budget exceeded');
    const source = this.createCanvas(width, height);
    const context = source.getContext('2d', {colorSpace: 'srgb'});
    if (!context) throw new DrawingError('SFRENDER084', 'Glyph Canvas2D context is unavailable');
    const logicalBounds = {x: (left - subpixelX) / dpr, y: (top - subpixelY) / dpr, width: width / dpr, height: height / dpr};
    context.setTransform(dpr, 0, 0, dpr, -logicalBounds.x * dpr, -logicalBounds.y * dpr);
    this.draw(context, glyph, {fill: color, dpr});
    return {source, width, height, logicalWidth: width / dpr, logicalHeight: height / dpr,
      logicalBounds, colorGlyph, alphaMode: 'premultiplied', colorSpace: 'srgb'};
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.images.dispose();
    this.glyphs.dispose();
  }
}
