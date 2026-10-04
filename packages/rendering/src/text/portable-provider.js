import {DrawingError} from '../drawing/commands.js';
import {loadBundledHarfBuzz} from './harfbuzz-loader.js';
import {PortableFontRegistry} from './font-registry.js';
import {HarfBuzzShaper} from './harfbuzz-shaper.js';
import {prepareText, textOptions} from './text-items.js';
import {shapeLines} from './shaped-lines.js';
import {positionText, portableInkBounds} from './positioned-text.js';
import {trimPortableText} from './portable-trimming.js';
import {segmentGraphemes, unicodeTextVersions} from './unicode.js';
import {PortableGlyphRasterizer} from './portable-rasterizer.js';
import {rasterizePortableText, paintPortableText} from './portable-paint.js';

const budgetLimits = Object.freeze({maxText: 1000000, maxClusters: 100000, maxGlyphs: 100000,
  maxLines: 4096, maxWorkGlyphs: 8000000, maxLineWork: 4000000, maxPixels: 16777216});

function budgets(options) {
  const values = {};
  for (const [name, maximum] of Object.entries(budgetLimits)) {
    const value = options[name] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new DrawingError('SFRENDER082', `Invalid ${name} text budget`);
    values[name] = value;
  }
  return values;
}

/** Portable HarfBuzz shaping with pinned Unicode algorithms, exact UTF-16 clusters, and owned font resources.
 * Synchronous layout performs no network work. shape() additionally awaits required color glyph decoding.
 */
export class HarfBuzzTextProvider {
  constructor({hb, module, fonts, createCanvas, decodeImage, ...options} = {}) {
    if (!hb?.createBuffer || !module?.wasmExports) throw new DrawingError('SFRENDER080', 'An initialized HarfBuzz factory is required');
    this.kind = 'harfbuzz';
    this.nativeRuns = false;
    this.capabilities = Object.freeze({nativeShaping: false, numericGlyphs: true, clusterMaps: true, richText: true, softWrapping: true});
    this.version = `harfbuzzjs-0.8.0/HarfBuzz-${hb.version_string()}`;
    this.unicodeVersions = unicodeTextVersions;
    this.budgets = budgets(options);
    this.module = module;
    this.hb = hb;
    this.fontVersion = 0;
    this.listeners = new Set();
    this.fonts = new PortableFontRegistry(hb, fonts, {...options, module});
    try {
      this.shaper = new HarfBuzzShaper({hb, module, ...this.budgets});
      this.rasterizer = new PortableGlyphRasterizer(this.fonts, {createCanvas, decodeImage, ...options,
        maxPixels: this.budgets.maxPixels, onChanged: () => this.changed()});
    } catch (error) {
      this.shaper?.dispose();
      this.fonts.dispose();
      throw error;
    }
  }
  segment(text, signal) { return segmentGraphemes(text, {maxClusters: this.budgets.maxClusters, signal}); }
  defaultMetrics(options) {
    const face = this.fonts.candidates(options, {emoji: false, characters: []})[0];
    const font = this.fonts.instance(face, options);
    const scale = options.fontSize / font.unitsPerEm;
    return {ascent: Math.max(0, font.metrics.ascender * scale), descent: Math.max(0, -font.metrics.descender * scale),
      lineGap: Math.max(0, font.metrics.lineGap * scale)};
  }
  layoutCore(text, input = {}) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Portable text provider is disposed');
    if (typeof text !== 'string' || text.length > this.budgets.maxText) throw new DrawingError('SFRENDER082', 'Text length exceeds provider budget');
    input.signal?.throwIfAborted();
    const options = textOptions(input);
    const prepared = prepareText(text, options, this.fonts, {...this.budgets, signal: options.signal});
    this.shaper.begin(text);
    let shaped;
    try { shaped = shapeLines(prepared, this.shaper, {...this.budgets, signal: options.signal}); }
    finally { this.shaper.end(); }
    const run = positionText(prepared, shaped, {defaultMetrics: this.defaultMetrics(options),
      providerVersion: this.version, fontVersion: this.fontVersion});
    if (run.glyphs.length > this.budgets.maxGlyphs) throw new DrawingError('SFRENDER082', 'Positioned glyph budget exceeded');
    run.inkBounds = portableInkBounds(run, glyph => this.glyphBounds(glyph));
    return run;
  }
  layout(text, options = {}) {
    const normalized = textOptions(options);
    const run = trimPortableText(this, this.layoutCore(text, normalized), normalized);
    run.inkBounds = portableInkBounds(run, glyph => this.glyphBounds(glyph));
    this.rasterizer.schedule(run);
    return run;
  }
  async shape(text, options = {}) {
    options.signal?.throwIfAborted();
    const run = this.layout(text, options);
    await this.rasterizer.prepare(run, options.signal);
    options.signal?.throwIfAborted();
    if (this.closed) throw new DrawingError('SFRENDER081', 'Portable text provider was disposed during shaping');
    run.version = this.fontVersion;
    return run;
  }
  glyphPath(glyph) { return this.rasterizer.glyphPath(glyph); }
  glyphBounds(glyph) { return this.rasterizer.glyphBounds(glyph); }
  glyphLayers(glyph) { return this.rasterizer.glyphLayers(glyph); }
  canInstanceGlyph(glyph) { return !this.glyphLayers(glyph)?.some(layer => layer.color === null); }
  rasterizeGlyph(glyph, options) { return this.rasterizer.rasterize(glyph, options); }
  paint(context, run, options) { return paintPortableText(context, run, {provider: this, ...options}); }
  rasterize(run, options) { return rasterizePortableText(this, run, options); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  changed() {
    if (this.closed) return;
    this.fontVersion++;
    for (const listener of this.listeners) listener(this.fontVersion);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.rasterizer.dispose();
    this.shaper.dispose();
    this.fonts.dispose();
    this.listeners.clear();
    this.module = null;
    this.hb = null;
  }
}

async function fontBytes(descriptor, options) {
  const supplied = descriptor.bytes ?? await options.loadBinary?.(descriptor.url, {signal: options.signal});
  const bytes = supplied instanceof ArrayBuffer ? new Uint8Array(supplied) : supplied;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12 || bytes.byteLength > 67108864) {
    throw new DrawingError('SFRENDER140', 'A bounded font buffer or explicit binary loader is required');
  }
  options.signal?.throwIfAborted();
  if (descriptor.sha256) {
    if (!/^[0-9a-f]{64}$/.test(descriptor.sha256) || !globalThis.crypto?.subtle) {
      throw new DrawingError('SFRENDER140', 'Pinned font verification requires SHA256 and Web Crypto');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== descriptor.sha256) throw new DrawingError('SFRENDER140', `Font integrity failed for ${descriptor.id}`);
  }
  return {...descriptor, bytes};
}

/** Initialize the bundled engine and caller-selected fonts through an explicit, cancellation-aware asset loader. */
export async function createPortableTextProvider(options = {}) {
  if (!Array.isArray(options.fonts) || !options.fonts.length || options.fonts.length > 128) {
    throw new DrawingError('SFRENDER140', 'Provide a bounded portable font collection');
  }
  const fonts = [];
  let bytes = 0;
  for (const descriptor of options.fonts) {
    options.signal?.throwIfAborted();
    const font = await fontBytes(descriptor, options);
    bytes += font.bytes.byteLength;
    if (bytes > (options.maxFontBytes ?? 134217728)) throw new DrawingError('SFRENDER140', 'Portable font collection exceeds its byte budget');
    fonts.push(font);
  }
  const engine = await loadBundledHarfBuzz(options);
  options.signal?.throwIfAborted();
  return new HarfBuzzTextProvider({...options, ...engine, fonts});
}
