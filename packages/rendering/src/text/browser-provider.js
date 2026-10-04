import {DrawingError, finite} from '../drawing/commands.js';
import {rasterizeNativeText} from './native-raster.js';
import {trimNativeLine, placeTrimmedLine} from './trimming.js';
import {textInkBounds} from './ink-bounds.js';

export function fontCss(options = {}) {
  const family = String(options.fontFamily?.Source ?? options.fontFamily ?? 'Segoe UI, system-ui, sans-serif').replace(/[;{}<>]/g, '');
  const style = ['normal', 'italic', 'oblique'].includes(options.fontStyle) ? options.fontStyle : 'normal';
  const weight = finite(options.fontWeight?.Weight ?? options.fontWeight ?? 400, 'font weight', 1, 1000);
  return `${style} ${weight} ${finite(options.fontSize ?? 14, 'font size', 1, 512)}px ${family}`;
}

/** Native browser layout performs shaping, bidi and line breaking on intact text runs.
 * Range geometry supplies UTF-16 cluster mapping; this is not a per-character shaping approximation.
 * Exact glyph IDs require an injected outline shaper; browser-native runs are opaque raster resources.
 */
export class BrowserTextProvider {
  constructor(document, {maxText = 1000000, maxClusters = 100000, maxPixels = 16777216} = {}) {
    if (!document?.createRange) throw new DrawingError('SFRENDER080', 'Native text shaping requires a browser document');
    if (![maxText, maxClusters, maxPixels].every(value => Number.isSafeInteger(value) && value > 0 && value <= 67108864)) {
      throw new DrawingError('SFRENDER082', 'Invalid text provider budget');
    }
    this.document = document; this.maxText = maxText; this.maxClusters = maxClusters; this.maxPixels = maxPixels;
    this.kind = 'browser-native'; this.nativeRuns = true; this.version = document.defaultView?.navigator?.userAgent ?? 'unknown browser';
    this.host = document.createElement('div');
    this.host.setAttribute('aria-hidden', 'true');
    Object.assign(this.host.style, {position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden',
      pointerEvents: 'none', contain: 'layout style paint', margin: '0', padding: '0', border: '0'});
    (document.body ?? document.documentElement).append(this.host);
    this.segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;
    this.disposed = false;
    this.listeners = new Set(); this.fontVersion = 0;
    this.fontsChanged = () => { this.fontVersion++; for (const listener of this.listeners) listener(this.fontVersion); };
    document.fonts?.addEventListener?.('loadingdone', this.fontsChanged);
  }

  async shape(text, options = {}) {
    options.signal?.throwIfAborted();
    await this.document.fonts?.load(fontCss(options), text);
    options.signal?.throwIfAborted();
    return this.layout(text, options);
  }

  layout(text, options = {}) {
    if (this.disposed) throw new DrawingError('SFRENDER081', 'Text provider is disposed');
    if (typeof text !== 'string' || text.length > this.maxText) throw new DrawingError('SFRENDER082', 'Text length exceeds budget');
    if (!this.segmenter) throw new DrawingError('SFRENDER083', 'Native grapheme segmentation is unavailable; use a shaped provider');
    const width = options.width == null || options.width === Infinity ? 100000 : finite(options.width, 'text width', 0, 100000);
    const fontSize = options.fontSize ?? 14, lineHeight = finite(options.lineHeight || fontSize * 1.2, 'line height', 0.01, 4096);
    finite(options.letterSpacing ?? 0, 'letter spacing', -4096, 4096);
    const element = this.host, wrap = options.wrapping ?? 'wrap';
    element.dir = options.direction ?? 'auto';
    Object.assign(element.style, {font: fontCss(options), width: `${width}px`, lineHeight: `${lineHeight}px`,
      whiteSpace: wrap === 'nowrap' || wrap === 0 ? 'pre' : 'pre-wrap', overflowWrap: wrap === 'wholewords' || wrap === 2 ? 'normal' : 'anywhere',
      textAlign: options.alignment ?? 'left', direction: ['rtl', 'ltr'].includes(options.direction) ? options.direction : '',
      unicodeBidi: options.direction === 'auto' || options.direction == null ? 'plaintext' : 'normal',
      fontKerning: 'normal', letterSpacing: `${options.letterSpacing ?? 0}px`, writingMode: 'horizontal-tb'});
    element.replaceChildren();
    const parts = options.runs?.length ? options.runs : [{start: 0, end: text.length, style: {}}], textNodes = [];
    let offset = 0;
    for (const part of parts) {
      if (part.start !== offset || part.end < part.start || part.end > text.length) throw new DrawingError('SFRENDER082', 'Invalid text style span');
      const span = this.document.createElement('span'); span.style.font = fontCss({...options, ...part.style});
      const node = this.document.createTextNode(text.slice(part.start, part.end)); span.append(node); element.append(span);
      textNodes.push({node, start: part.start, end: part.end, style: {...options, ...part.style}, font: span.style.font}); offset = part.end;
    }
    if (offset !== text.length) throw new DrawingError('SFRENDER082', 'Text spans do not cover the shaped text');
    let firstPart = 0, lastPart = 0;
    const direction = this.document.defaultView.getComputedStyle(element).direction;
    const root = element.getBoundingClientRect(), range = this.document.createRange(), lineMap = new Map();
    let clusters = [];
    const segments = this.segmenter.segment(text);
    for (const segment of segments) {
      const start = segment.index, end = start + segment.segment.length;
      while (firstPart + 1 < textNodes.length && textNodes[firstPart].end <= start) firstPart++;
      while (lastPart + 1 < textNodes.length && textNodes[lastPart].end < end) lastPart++;
      const first = textNodes[firstPart], last = textNodes[lastPart];
      range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
      const boxes = Array.from(range.getClientRects(), rect => [rect.left - root.left, rect.top - root.top, rect.width, rect.height]);
      const box = boxes[0] ?? [0, 0, 0, lineHeight];
      const key = Math.round(box[1] * 64), line = lineMap.get(key) ?? {top: box[1], height: box[3], clusters: [], start, end};
      line.end = end; line.height = Math.max(line.height, box[3]);
      const cluster = {start, end, text: segment.segment, rects: boxes, line: 0, rtl: false,
        font: first.font, style: first.style};
      clusters.push(cluster); line.clusters.push(cluster); lineMap.set(key, line);
      if (clusters.length > this.maxClusters) throw new DrawingError('SFRENDER082', 'Text cluster budget exceeded');
    }
    const lines = [...lineMap.values()].sort((a, b) => a.top - b.top);
    const measurement = this.document.createElement('canvas').getContext('2d');
    if (!measurement) throw new DrawingError('SFRENDER084', 'Native text rasterization is unavailable');
    measurement.font = fontCss(options);
    if ('letterSpacing' in measurement) measurement.letterSpacing = `${options.letterSpacing ?? 0}px`;
    const metrics = measurement.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || fontSize * 0.8;
    const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || fontSize * 0.2;
    lines.forEach((line, index) => {
      line.text = text.slice(line.start, line.end).replace(/[\r\n]+$/, '');
      line.baseline = line.top + ascent;
      line.direction = direction;
      const visual = [...line.clusters].filter(cluster => cluster.rects.length).sort((a, b) => a.rects[0][0] - b.rects[0][0]);
      line.visualClusters = visual;
      line.left = visual.length ? visual[0].rects[0][0] : 0;
      let right = line.left;
      for (const cluster of visual) for (const rect of cluster.rects) right = Math.max(right, rect[0] + rect[2]);
      line.width = right - line.left;
      for (let at = 0; at < line.clusters.length; at++) {
        const cluster = line.clusters[at], next = line.clusters[at + 1], previous = line.clusters[at - 1];
        cluster.line = index;
        cluster.rtl = next?.rects.length && cluster.rects.length ? next.rects[0][0] < cluster.rects[0][0] :
          previous?.rects.length && cluster.rects.length ? cluster.rects[0][0] < previous.rects[0][0] : line.direction === 'rtl';
      }
      line.fontRuns = [];
      for (const cluster of line.clusters) {
        if (/^[\r\n]+$/.test(cluster.text)) continue;
        let group = line.fontRuns.at(-1);
        if (!group || group.font !== cluster.font) {
          group = {font: cluster.font, text: '', left: Infinity, width: 0, right: 0, baseline: line.baseline,
            direction, paints: [], style: cluster.style, top: cluster.rects[0]?.[1] ?? line.top}; line.fontRuns.push(group);
        }
        group.text += cluster.text;
        for (const box of cluster.rects) { group.left = Math.min(group.left, box[0]); group.right = Math.max(group.right, box[0] + box[2]); }
        group.width = group.right - group.left;
        let paint = group.paints.at(-1);
        if (!paint || paint.style !== cluster.style) { paint = {style: cluster.style, rects: []}; group.paints.push(paint); }
        paint.rects.push(...cluster.rects);
      }
      for (const group of line.fontRuns) {
        if (!Number.isFinite(group.left)) { group.left = line.left; group.width = 0; }
        measurement.font = group.font; const measure = measurement.measureText('Mg');
        group.baseline = group.top + (measure.fontBoundingBoxAscent || measure.actualBoundingBoxAscent || ascent);
        if (options.alignment === 'justify') {
          const spaces = group.text.match(/\s/g)?.length ?? 0;
          group.wordSpacing = spaces ? Math.max(0, (group.width - measurement.measureText(group.text).width) / spaces) : 0;
        }
        if (group.paints.length === 1) group.paints[0].rects = null;
      }
      measurement.font = fontCss(options);
    });
    const maxLines = finite(options.maxLines ?? 0, 'maximum text lines', 0, this.maxClusters);
    if (!Number.isInteger(maxLines)) throw new DrawingError('SFRENDER082', 'Maximum text lines must be an integer');
    const visibleLines = maxLines ? lines.slice(0, maxLines) : lines;
    let trimmed = visibleLines.length < lines.length;
    if (visibleLines.length && options.trimming && (trimmed || visibleLines.at(-1).width > width)) {
      const original = visibleLines.at(-1), result = trimNativeLine(this.document, element, original, {...options, width}, fontCss);
      const shaped = this.layout(result.text, {...options, width, runs: result.runs, maxLines: 0, trimming: 0,
        wrapping: 'nowrap', direction: original.direction, alignment: options.alignment === 'justify' ? 'start' : options.alignment});
      const replacement = placeTrimmedLine(shaped, original, original.start + result.end, visibleLines.length - 1);
      visibleLines[visibleLines.length - 1] = replacement.line;
      clusters = clusters.filter(cluster => cluster.line < visibleLines.length - 1).concat(replacement.clusters); trimmed = true;
    }
    const height = visibleLines.length ? visibleLines.at(-1).top + Math.max(lineHeight, visibleLines.at(-1).height) : lineHeight;
    const result = {kind: 'glyphRun', text, font: fontCss(options), fontSize, lineHeight, ascent, descent,
      width: Math.min(width, visibleLines.reduce((maximum, line) => Math.max(maximum, line.left + line.width), 0)), height,
      lines: visibleLines, clusters: clusters.filter(cluster => cluster.line < visibleLines.length), trimmed,
      provider: this.kind, providerVersion: this.version,
      glyphAccess: 'opaque-native-runs', options: {...options, width}, version: this.fontVersion};
    result.inkBounds = textInkBounds(result, measurement);
    return result;
  }

  rasterize(run, options) {
    return rasterizeNativeText(run, {provider: this.kind, maxPixels: this.maxPixels, createCanvas: (width, height) => {
      const canvas = this.document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
    }}, options);
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose() {
    this.disposed = true; this.host.remove(); this.listeners.clear(); this.document.fonts?.removeEventListener?.('loadingdone', this.fontsChanged);
  }
}
