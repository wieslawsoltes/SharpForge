import {DrawingError} from '../drawing/commands.js';
import {glyphRasterKey, glyphRasterMetrics} from './glyph-key.js';

/** Bounded shelf atlas for glyphs or opaque native shaped runs; generations invalidate evicted UVs. */
export class GlyphAtlas {
  constructor({createCanvas, size = 2048, maxBytes = 32 * 1024 * 1024, padding = 1, subpixelBuckets = 4, maxEntries = 32768} = {}) {
    if (typeof createCanvas !== 'function' || !Number.isInteger(size) || size < 32 || size > 8192 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < size * size * 4 || !Number.isInteger(padding) || padding < 0 || padding * 2 >= size) {
      throw new DrawingError('SFRENDER086', 'Invalid glyph atlas configuration');
    }
    if (!Number.isInteger(subpixelBuckets) || subpixelBuckets < 1 || subpixelBuckets > 16
      || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 262144) {
      throw new DrawingError('SFRENDER086', 'Invalid glyph atlas metadata budget or subpixel buckets');
    }
    this.createCanvas = createCanvas; this.size = size; this.maxBytes = maxBytes; this.padding = padding;
    this.pages = []; this.entries = new Map(); this.serial = 0; this.generation = 0; this.closed = false;
    this.subpixelBuckets = subpixelBuckets; this.maxEntries = maxEntries; this.emptyEntries = new Map();
  }
  get(key) {
    if (this.closed) throw new DrawingError('SFRENDER086', 'Glyph atlas is disposed');
    const entry = this.entries.get(key);
    if (entry) { entry.used = ++this.serial; entry.page.used = this.serial; }
    return entry ?? null;
  }
  getGlyph(glyph, {provider, dpr = 1, subpixelX = 0, subpixelY = 0} = {}) {
    const raster = glyphRasterKey(glyph, {dpr, subpixelX, subpixelY, buckets: this.subpixelBuckets});
    const cached = this.get(raster.key) ?? this.emptyEntries.get(raster.key);
    if (cached) {
      if (cached.empty) { this.emptyEntries.delete(raster.key); this.emptyEntries.set(raster.key, cached); }
      return cached;
    }
    if (typeof provider?.rasterizeGlyph !== 'function') throw new DrawingError('SFRENDER132', 'Numeric glyph raster provider is unavailable');
    const image = provider.rasterizeGlyph(glyph, {...raster, color: '#ffffff'});
    const metrics = glyphRasterMetrics(image, this.size - this.padding * 2);
    if (image.pending === true) return {key: raster.key, empty: true, pending: true, metrics};
    if (!image.width || !image.height) {
      if (this.emptyEntries.size >= 512) this.emptyEntries.delete(this.emptyEntries.keys().next().value);
      const empty = {key: raster.key, empty: true, metrics};
      this.emptyEntries.set(raster.key, empty);
      return empty;
    }
    return this.add(raster.key, image, {metrics});
  }
  add(key, image, {width = image.width, height = image.height, metrics = null} = {}) {
    if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= this.size)) {
      throw new DrawingError('SFRENDER086', 'Atlas glyph dimensions must be positive bounded integers');
    }
    const cached = this.get(key); if (cached) return cached;
    const paddedWidth = width + this.padding * 2, paddedHeight = height + this.padding * 2;
    if (paddedWidth > this.size || paddedHeight > this.size) throw new DrawingError('SFRENDER086', 'Glyph run exceeds atlas page; split at line boundaries');
    if (this.entries.size >= this.maxEntries) this.recyclePage(true);
    let page = this.pages.find(candidate => this.fits(candidate, paddedWidth, paddedHeight));
    if (!page) page = this.newPage();
    if (page.x + paddedWidth > this.size) { page.x = 0; page.y += page.rowHeight; page.rowHeight = 0; }
    const x = page.x + this.padding, y = page.y + this.padding;
    page.context.drawImage(image.source ?? image, x, y, width, height);
    this.markDirty(page, [x - this.padding, y - this.padding, paddedWidth, paddedHeight]);
    page.x += paddedWidth; page.rowHeight = Math.max(page.rowHeight, paddedHeight); page.version++; page.used = ++this.serial;
    const entry = {key, page, x, y, width, height, metrics, generation: page.generation, used: this.serial,
      uv: [x / this.size, y / this.size, (x + width) / this.size, (y + height) / this.size]};
    this.entries.set(key, entry); page.keys.add(key); return entry;
  }
  fits(page, width, height) {
    return page.x + width <= this.size && page.y + height <= this.size || page.y + page.rowHeight + height <= this.size;
  }
  newPage() {
    const bytes = this.size * this.size * 4;
    if (bytes > this.maxBytes) throw new DrawingError('SFRENDER086', 'Atlas page exceeds memory budget');
    if ((this.pages.length + 1) * bytes > this.maxBytes) {
      return this.recyclePage();
    }
    const canvas = this.createCanvas(this.size, this.size), context = canvas.getContext('2d');
    if (!context) throw new DrawingError('SFRENDER086', 'Atlas raster context is unavailable');
    const page = {canvas, context, x: 0, y: 0, rowHeight: 0, keys: new Set(), pins: 0,
      generation: ++this.generation, version: 0, used: ++this.serial, dirtyBounds: [0, 0, this.size, this.size]};
    this.pages.push(page); return page;
  }
  recyclePage(requireEntries = false) {
    let oldest = null;
    for (const page of this.pages) if (!page.pins && (!requireEntries || page.keys.size) && (!oldest || page.used < oldest.used)) oldest = page;
    if (!oldest) throw new DrawingError('SFRENDER086', 'Live text display lists exhaust the glyph atlas budget');
    for (const key of oldest.keys) this.entries.delete(key);
    oldest.context.clearRect(0, 0, this.size, this.size); oldest.keys.clear();
    oldest.x = oldest.y = oldest.rowHeight = 0; oldest.generation = ++this.generation; oldest.version++;
    oldest.dirtyBounds = [0, 0, this.size, this.size];
    return oldest;
  }
  markDirty(page, bounds) {
    const previous = page.dirtyBounds;
    if (!previous) { page.dirtyBounds = bounds; return; }
    const left = Math.min(previous[0], bounds[0]), top = Math.min(previous[1], bounds[1]);
    page.dirtyBounds = [left, top, Math.max(previous[0] + previous[2], bounds[0] + bounds[2]) - left,
      Math.max(previous[1] + previous[3], bounds[1] + bounds[3]) - top];
  }
  valid(entry) {
    if (!entry || this.closed) return false;
    if (entry.empty) return this.emptyEntries.get(entry.key) === entry;
    return this.entries.get(entry.key) === entry && entry.generation === entry.page.generation;
  }
  get bytes() { return this.pages.length * this.size * this.size * 4; }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const page of this.pages) { page.canvas.width = 0; page.canvas.height = 0; }
    this.pages.length = 0; this.entries.clear(); this.emptyEntries.clear();
  }
}
