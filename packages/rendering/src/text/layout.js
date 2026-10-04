import {DrawingError} from '../drawing/commands.js';
import {rasterizeNativeText} from './native-raster.js';

/** Provider API requires actual native or outline shaping; drawing-only providers explicitly mark unavailable cluster geometry. */
export class TextLayoutService {
  constructor(provider, {maxEntries = 2048, maxCharacters = 2000000} = {}) {
    if (!provider?.layout || !provider?.rasterize) throw new DrawingError('SFRENDER085', 'A native or outline shaping provider is required');
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
      throw new DrawingError('SFRENDER082', 'Invalid text layout cache budget');
    }
    this.provider = provider; this.maxEntries = maxEntries; this.maxCharacters = maxCharacters;
    this.cache = new Map(); this.characters = 0;
    this.listeners = new Set(); this.unsubscribe = provider.subscribe?.(() => { this.clear(); for (const listener of this.listeners) listener(); });
  }
  layout(text, options = {}) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Text layout service is disposed');
    options.signal?.throwIfAborted();
    const key = JSON.stringify([text, options.fontFamily, options.fontSize, options.fontWeight, options.fontStyle,
      options.width, options.wrapping, options.alignment, options.direction, options.lineHeight, options.maxLines,
      options.trimming, options.letterSpacing, options.tabSize, options.language, options.features, options.variations, options.foreground,
      options.underline, options.strikethrough, options.runs, this.provider.fontVersion]);
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const run = this.provider.layout(text, options);
    if (text.length > this.maxCharacters) return run;
    while (this.cache.size >= this.maxEntries || this.characters + text.length > this.maxCharacters) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.characters -= this.cache.get(oldest).text.length; this.cache.delete(oldest);
    }
    this.cache.set(key, run); this.characters += text.length; return run;
  }
  async shape(text, options = {}) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Text layout service is disposed');
    options.signal?.throwIfAborted();
    const run = await (this.provider.shape ? this.provider.shape(text, options) : this.provider.layout(text, options));
    options.signal?.throwIfAborted(); this.clear(); return run;
  }
  rasterize(run, options) {
    if (run.glyphAccess === 'opaque-native-runs' && !this.provider.nativeRuns && this.provider.rasterizer?.createCanvas) {
      return rasterizeNativeText(run, {provider: run.provider, maxPixels: this.provider.budgets?.maxPixels ?? 16777216,
        createCanvas: this.provider.rasterizer.createCanvas}, options);
    }
    return this.provider.rasterize(run, options);
  }
  clear() { this.cache.clear(); this.characters = 0; }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.clear(); this.unsubscribe?.(); this.listeners.clear(); this.provider.dispose?.();
  }
}

/** Cluster-aware logical caret geometry. UTF-16 offsets inside a grapheme snap to an explicit affinity. */
export function caretRectangle(run, position, affinity = 'forward') {
  requireClusters(run);
  position = Math.max(0, Math.min(run.text.length, position));
  let low = 0, high = run.clusters.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (run.clusters[middle].start <= position) low = middle + 1; else high = middle;
  }
  let index = Math.max(0, low - 1);
  while (index >= 0 && run.clusters[index]?.line >= run.lines.length) index--;
  const cluster = run.clusters[index];
  if (!cluster?.rects.length) return [0, 0, 1, run.lineHeight];
  const end = position >= cluster.end || position > cluster.start && affinity === 'forward';
  const rect = end ? cluster.rects.at(-1) : cluster.rects[0], right = cluster.rtl ? !end : end;
  return [rect[0] + (right ? rect[2] : 0), rect[1], 1, rect[3]];
}
export function hitTestText(run, x, y) {
  requireClusters(run);
  let best = null, distance = Infinity;
  for (const cluster of run.clusters) for (const rect of cluster.rects) {
    if (cluster.line >= run.lines.length) continue;
    const dx = Math.max(rect[0] - x, 0, x - rect[0] - rect[2]), dy = Math.max(rect[1] - y, 0, y - rect[1] - rect[3]);
    const candidate = dx * dx + dy * dy;
    if (candidate < distance) { best = {cluster, rect}; distance = candidate; }
  }
  if (!best) return {position: 0, affinity: 'forward', inside: false};
  const trailing = (x >= best.rect[0] + best.rect[2] / 2) !== best.cluster.rtl;
  return {position: trailing ? best.cluster.end : best.cluster.start, affinity: trailing ? 'backward' : 'forward', inside: distance === 0};
}
export function selectionRectangles(run, start, end) {
  requireClusters(run);
  if (start > end) [start, end] = [end, start];
  const rectangles = [];
  for (const cluster of run.clusters) if (cluster.start < end && cluster.end > start && cluster.line < run.lines.length) {
    for (const rect of cluster.rects) rectangles.push([...rect]);
  }
  rectangles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const result = [];
  for (const rect of rectangles) {
    const last = result.at(-1);
    if (last && Math.abs(last[1] - rect[1]) < 0.1 && Math.abs(last[3] - rect[3]) < 0.1 && rect[0] <= last[0] + last[2] + 0.1) {
      last[2] = Math.max(last[0] + last[2], rect[0] + rect[2]) - last[0];
    } else result.push(rect);
  }
  return result;
}

function requireClusters(run) {
  if (run.clusterAccess === 'unavailable') throw new DrawingError('SFRENDER089', 'Caret and selection geometry require a cluster-aware text provider');
}

export const hybridTextInputPolicy = Object.freeze({version: 1, text: 'renderer', editing: 'native-overlay',
  ime: 'native-input', clipboard: 'native-input', accessibility: 'native-input',
  fallback: 'DOM control when native overlay positioning cannot be guaranteed'});
