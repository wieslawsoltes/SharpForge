import {normalizeBrush, solidCss, brushMatrix} from '../brushes/brushes.js';
import {rasterizeBrush, decodedImage} from '../brushes/rasterizer.js';
import {cssColor} from '../media/colors.js';
import {imageRectangle} from '../media/images.js';
import {DrawingError, resolveResource} from '../drawing/commands.js';

/** Canvas paint preparation; repeated complex gradient tiles are cached under a bounded pixel budget. */
export class CanvasPaints {
  constructor(createCanvas, {maxPixels = 16777216} = {}) {
    this.createCanvas = createCanvas; this.maxPixels = maxPixels; this.cache = new Map(); this.pixels = 0;
  }
  get(context, input, bounds, resources, options = {}) {
    const brush = normalizeBrush(input, resources, options.resolve);
    if (!brush) return null;
    if (brush.kind === 'solid') return solidCss(brush);
    if (brush.kind === 'image') {
      let image = decodedImage(resolveResource(resources, brush.image, 'image'), this.createCanvas);
      if (brush.opacity !== 1) {
        const source = this.createCanvas(image.width, image.height), raster = source.getContext('2d');
        raster.globalAlpha = brush.opacity; raster.drawImage(image.source, 0, 0); image = {...image, source};
      }
      const pattern = context.createPattern(image.source, 'no-repeat');
      const fit = imageRectangle(image, bounds, brush).destination;
      const matrix = brushMatrix(brush, bounds);
      if (pattern?.setTransform) pattern.setTransform({a: matrix[0] * fit[2] / image.width,
        b: matrix[1] * fit[2] / image.width, c: matrix[2] * fit[3] / image.height,
        d: matrix[3] * fit[3] / image.height, e: matrix[0] * fit[0] + matrix[2] * fit[1] + matrix[4],
        f: matrix[1] * fit[0] + matrix[3] * fit[1] + matrix[5]});
      return pattern;
    }
    if (brush.kind === 'linear' && brush.spread === 'pad' && brush.interpolation === 'srgb') {
      context.save(); context.transform(...brushMatrix(brush, bounds));
      const point = value => brush.mapping === 'absolute' ? value : [bounds[0] + value[0] * bounds[2], bounds[1] + value[1] * bounds[3]];
      const gradient = context.createLinearGradient(...point(brush.start), ...point(brush.end));
      for (const stop of brush.stops) { const color = [...stop.color]; color[3] *= brush.opacity;
        gradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), cssColor(color)); }
      context.restore(); return gradient;
    }
    const scale = options.dpr ?? 1, width = Math.max(1, Math.ceil(bounds[2] * scale)), height = Math.max(1, Math.ceil(bounds[3] * scale));
    if (width * height > this.maxPixels) throw new DrawingError('SFRENDER067', 'Brush raster exceeds pixel budget');
    const dynamic = ['acrylic', 'backdrop', 'mask', 'nine-grid', 'effect'].includes(brush.kind);
    const key = JSON.stringify([brush, bounds, scale, resources?.version]);
    let canvas = dynamic ? null : this.cache.get(key);
    if (!canvas) {
      canvas = rasterizeBrush(brush, bounds, resources, {...options, createCanvas: this.createCanvas, maxPixels: this.maxPixels}).source;
      while (this.pixels + width * height > this.maxPixels && this.cache.size) {
        const oldest = this.cache.keys().next().value, old = this.cache.get(oldest);
        this.pixels -= old.width * old.height; this.cache.delete(oldest);
      }
      if (!dynamic) { this.cache.set(key, canvas); this.pixels += width * height; }
    }
    const pattern = context.createPattern(canvas, 'no-repeat');
    pattern?.setTransform?.({a: 1 / scale, b: 0, c: 0, d: 1 / scale, e: bounds[0], f: bounds[1]});
    return pattern;
  }
  dispose() { this.cache.clear(); this.pixels = 0; }
}
