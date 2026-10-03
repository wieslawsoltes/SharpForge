import {graphemeSegments, graphemeWidth} from '@sharpforge/text';

/** Cached grapheme geometry. Offsets are UTF-16; x and height are CSS pixels. */
export class LineLayout {
  constructor({font = '14px Consolas, monospace', tabSize = 4, lineHeight = 22, measure = null, limit = 512} = {}) {
    this.font = font;
    this.tabSize = tabSize;
    this.lineHeight = lineHeight;
    this.measure = measure;
    this.limit = limit;
    this.cache = new Map();
    this.charWidth = 8.4;
    this.revision = 0;
  }

  configure({font = this.font, tabSize = this.tabSize, lineHeight = this.lineHeight, charWidth = this.charWidth} = {}) {
    if (!Number.isFinite(lineHeight) || lineHeight <= 0 || !Number.isInteger(tabSize) || tabSize < 1 || tabSize > 32) {
      throw new RangeError('Invalid editor line metrics');
    }
    if (font === this.font && tabSize === this.tabSize && lineHeight === this.lineHeight && charWidth === this.charWidth) return;
    Object.assign(this, {font, tabSize, lineHeight, charWidth});
    this.revision++;
    this.cache.clear();
  }

  line(text, version = 0) {
    const key = `${this.revision}:${version}:${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const segments = graphemeSegments(text);
    const offsets = new Uint32Array(segments.length + 1);
    const columns = new Float64Array(segments.length + 1);
    const pixels = new Float64Array(segments.length + 1);
    let column = 0;
    let x = 0;
    for (let index = 0; index < segments.length; index++) {
      const item = segments[index];
      offsets[index] = item.index;
      columns[index] = column;
      pixels[index] = x;
      const width = graphemeWidth(item.segment, column, {tabSize: this.tabSize});
      const measured = item.segment === '\t' ? width * this.charWidth : this.measure?.(item.segment, this.font);
      x += Number.isFinite(measured) ? measured : width * this.charWidth;
      column += width;
    }
    offsets[segments.length] = text.length;
    columns[segments.length] = column;
    pixels[segments.length] = x;
    const layout = {text, offsets, columns, pixels, width: x, height: this.lineHeight};
    this.cache.set(key, layout);
    if (this.cache.size > this.limit) this.cache.delete(this.cache.keys().next().value);
    return layout;
  }

  xAt(layout, offset) {
    const index = upperBound(layout.offsets, Math.max(0, offset)) - 1;
    return layout.pixels[Math.max(0, index)];
  }

  offsetAt(layout, x, bias = 'nearest') {
    const right = Math.min(layout.pixels.length - 1, upperBound(layout.pixels, x));
    const left = Math.max(0, right - 1);
    if (bias === 'left') return layout.offsets[left];
    if (bias === 'right') return layout.offsets[right];
    return layout.offsets[x - layout.pixels[left] <= layout.pixels[right] - x ? left : right];
  }

  dispose() { this.cache.clear(); }
}

/** First index whose value is strictly greater than target. */
export function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function canvasMeasure(document) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d');
  if (!context) return null;
  return (text, font) => {
    if (context.font !== font) context.font = font;
    return context.measureText(text).width;
  };
}
