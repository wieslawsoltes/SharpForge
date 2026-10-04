import {boundsOfPoints, inverseMatrix, rectanglePoints, transformPoint} from '@sharpforge/designer';

function localTextOrigin(entry, rectangle, fontHeight) {
  const [a, b, c, d] = entry.matrix;
  const determinant = Math.abs(a * d) - Math.abs(b * c);
  let width;
  let height;
  if (Math.abs(determinant) > 1e-8) {
    width = (rectangle.width * Math.abs(d) - rectangle.height * Math.abs(c)) / determinant;
    height = (rectangle.height * Math.abs(a) - rectangle.width * Math.abs(b)) / determinant;
  } else {
    height = fontHeight;
    width = Math.abs(a) > Math.abs(b) ? (rectangle.width - Math.abs(c) * height) / Math.abs(a)
      : (rectangle.height - Math.abs(d) * height) / Math.abs(b);
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return null;
  const matrix = [a, b, c, d, 0, 0];
  const bounds = boundsOfPoints(rectanglePoints({Width: width, Height: height}, matrix));
  const origin = transformPoint(inverseMatrix(entry.matrix), {x: rectangle.left - bounds.Left, y: rectangle.top - bounds.Top});
  return {top: origin.y, height};
}

/** Read actual browser font metrics and the first rendered text line during the geometry read phase. */
export class DesignerTextBaselines {
  constructor(document) {
    this.document = document;
    this.context = null;
    this.fonts = new Map();
  }

  metrics(style) {
    const font = style.font || `${style.fontStyle || 'normal'} ${style.fontWeight || 'normal'} ${style.fontSize} ${style.fontFamily}`;
    if (this.fonts.has(font)) return this.fonts.get(font);
    this.context ??= this.document.createElement('canvas').getContext('2d');
    if (!this.context) return null;
    this.context.font = font;
    const metrics = this.context.measureText('Hg');
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent + descent <= 0) return null;
    const value = {ascent, height: ascent + descent};
    if (this.fonts.size >= 128) this.fonts.delete(this.fonts.keys().next().value);
    this.fonts.set(font, value);
    return value;
  }

  measure(entry) {
    const text = [...entry.element.childNodes ?? []].find(node => node.nodeType === 3 && node.textContent.trim());
    if (!text || !this.document.createRange || !this.document.createElement) return null;
    const metrics = this.metrics(entry.style);
    if (!metrics) return null;
    const range = this.document.createRange();
    range.selectNodeContents(text);
    const rectangle = range.getClientRects()[0];
    range.detach?.();
    if (!rectangle) return null;
    const line = localTextOrigin(entry, rectangle, metrics.height);
    return line ? line.top + (line.height - metrics.height) / 2 + metrics.ascent : null;
  }

  dispose() {
    this.fonts.clear();
    this.context = null;
  }
}
