import {DrawingError, finite} from '../drawing/commands.js';
import {fontCss} from './browser-provider.js';
import {textInkBounds} from './ink-bounds.js';
import {rasterizeNativeText} from './native-raster.js';

function defaultCanvas(width, height) {
  if (typeof globalThis.OffscreenCanvas !== 'function') throw new DrawingError('SFRENDER080', 'Worker native text requires OffscreenCanvas');
  return new globalThis.OffscreenCanvas(width, height);
}

/** Worker drawing uses native Canvas shaping of intact lines; it does not pretend to expose numeric glyphs or DOM cluster geometry. */
export class NativeCanvasTextProvider {
  constructor({createCanvas = defaultCanvas, fonts = globalThis.fonts, maxText = 1000000, maxLines = 4096,
    maxPixels = 16777216, version = globalThis.navigator?.userAgent ?? 'native-canvas'} = {}) {
    if (![maxText, maxLines, maxPixels].every(value => Number.isSafeInteger(value) && value > 0 && value <= 67108864)) {
      throw new DrawingError('SFRENDER082', 'Invalid worker text provider budget');
    }
    this.createCanvas = createCanvas;
    this.canvas = createCanvas(1, 1);
    this.context = this.canvas.getContext('2d');
    if (!this.context?.measureText || !this.context.fillText) throw new DrawingError('SFRENDER084', 'Native Canvas text is unavailable');
    this.fonts = fonts; this.maxText = maxText; this.maxLines = maxLines; this.maxPixels = maxPixels;
    this.kind = 'native-canvas'; this.nativeRuns = true; this.version = version; this.fontVersion = 0; this.closed = false;
    this.capabilities = Object.freeze({nativeShaping: true, numericGlyphs: false, clusterMaps: false, richText: false, softWrapping: false});
    this.listeners = new Set();
    this.fontsChanged = () => { this.fontVersion++; for (const listener of this.listeners) listener(this.fontVersion); };
    fonts?.addEventListener?.('loadingdone', this.fontsChanged);
  }

  async shape(text, options = {}) {
    options.signal?.throwIfAborted();
    await this.fonts?.load(fontCss(options), text);
    options.signal?.throwIfAborted();
    return this.layout(text, options);
  }

  layout(text, options = {}) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Worker text provider is disposed');
    if (typeof text !== 'string' || text.length > this.maxText) throw new DrawingError('SFRENDER082', 'Worker text length exceeds budget');
    if (![undefined, 'nowrap', 0].includes(options.wrapping) || options.runs?.length || options.trimming ||
      options.alignment === 'justify' || options.direction === 'auto') {
      throw new DrawingError('SFRENDER089', 'Wrapped, rich, automatic-direction or trimmed layout requires BrowserTextProvider or a full shaping provider');
    }
    const fontSize = finite(options.fontSize ?? 14, 'font size', 1, 512);
    const lineHeight = finite(options.lineHeight ?? fontSize * 1.2, 'line height', 0.01, 4096);
    const width = options.width == null || options.width === Infinity ? null : finite(options.width, 'text width', 0, 1000000);
    const letterSpacing = finite(options.letterSpacing ?? 0, 'letter spacing', -4096, 4096);
    const maxLines = finite(options.maxLines ?? 0, 'maximum lines', 0, this.maxLines);
    if (!Number.isInteger(maxLines)) throw new DrawingError('SFRENDER082', 'Maximum text lines must be an integer');
    const lines = [], parts = text.split(/\r\n|\r|\n/);
    if (parts.length > this.maxLines) throw new DrawingError('SFRENDER082', 'Worker text line budget exceeded');
    const context = this.context, font = fontCss(options), direction = options.direction === 'rtl' ? 'rtl' : 'ltr';
    context.font = font; context.direction = direction; context.textAlign = 'left'; context.fontKerning = 'normal';
    if (letterSpacing && !('letterSpacing' in context)) throw new DrawingError('SFRENDER088', 'Character spacing requires native letter spacing');
    if ('letterSpacing' in context) context.letterSpacing = `${letterSpacing}px`;
    if ('wordSpacing' in context) context.wordSpacing = '0px';
    const metrics = context.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    if (![ascent, descent].every(Number.isFinite)) throw new DrawingError('SFRENDER084', 'Native font ascent/descent metrics are unavailable');
    let offset = 0, measuredWidth = 0;
    for (const [index, part] of parts.entries()) {
      if (maxLines && index >= maxLines) break;
      const naturalWidth = finite(context.measureText(part).width, 'native text advance', 0, 1e9);
      const available = width ?? naturalWidth;
      const align = options.alignment ?? 'left';
      const right = align === 'right' || align === 'end' && direction === 'ltr' || align === 'start' && direction === 'rtl';
      const left = right ? available - naturalWidth : align === 'center' ? (available - naturalWidth) / 2 : 0;
      const top = index * lineHeight, baseline = top + (lineHeight - ascent - descent) / 2 + ascent;
      lines.push({text: part, start: offset, end: offset + part.length, top, height: lineHeight, width: naturalWidth,
        left, baseline, direction, fontRuns: [{text: part, font, left, width: naturalWidth, baseline, direction,
          paints: [{style: options, rects: null}]}]});
      measuredWidth = Math.max(measuredWidth, left + naturalWidth); offset += part.length + 1;
    }
    const normalized = {...options, width, letterSpacing};
    delete normalized.signal;
    const run = {kind: 'glyphRun', text, font, fontSize, lineHeight, ascent, descent,
      width: Math.max(0, measuredWidth), height: Math.max(lineHeight, lines.length * lineHeight), lines, clusters: [],
      clusterAccess: 'unavailable', glyphAccess: 'opaque-native-runs', provider: this.kind, providerVersion: this.version,
      trimmed: lines.length < parts.length, options: normalized, version: this.fontVersion};
    for (const line of lines) line.fontRuns[0].paints[0].style = normalized;
    run.inkBounds = textInkBounds(run, context);
    return run;
  }

  rasterize(run, options) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Worker text provider is disposed');
    return rasterizeNativeText(run, {createCanvas: this.createCanvas, maxPixels: this.maxPixels, provider: this.kind}, options);
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.fonts?.removeEventListener?.('loadingdone', this.fontsChanged); this.listeners.clear();
    this.canvas.width = this.canvas.height = 0;
  }
}
