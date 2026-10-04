import {DrawingError, finite} from '../drawing/commands.js';
import {normalizeBrush} from '../brushes/brushes.js';

export function colorGlyphOpacity(input, resources, resolve) {
  const brush = normalizeBrush(input, resources, resolve);
  return brush ? brush.opacity * (brush.kind === 'solid' ? brush.color[3] : 1) : 0;
}

/** Paint positioned numeric glyphs, preserving intrinsic OpenType color layers and span foregrounds. */
export function paintPortableText(context, run, {provider, paint, opacity, dpr = 1, color = '#000000', overrideColors = false} = {}) {
  if (!provider?.rasterizer || run.glyphAccess !== 'numeric-glyphs') {
    throw new DrawingError('SFRENDER085', 'Numeric text painting requires the matching portable font provider');
  }
  context.save();
  try {
    for (const glyph of run.glyphs) {
      const fill = paint?.(overrideColors ? null : glyph.foreground, context) ?? color;
      context.save();
      try {
        context.translate(glyph.x, glyph.y);
        provider.rasterizer.draw(context, glyph, {fill, dpr, overrideColors, intrinsicOpacity: opacity?.(glyph.foreground) ?? 1});
      } finally { context.restore(); }
    }
    for (const decoration of run.decorations ?? []) {
      context.fillStyle = paint?.(overrideColors ? null : decoration.foreground, context) ?? color;
      context.fillRect(...decoration.rect);
    }
  } finally { context.restore(); }
}

/** Rasterize a complete retained numeric layout; ink bounds include accents, italic overhangs, and decorations. */
export function rasterizePortableText(provider, run, options = {}) {
  const dpr = finite(options.dpr ?? 1, 'text raster density', 0.25, 8);
  const bounds = run.inkBounds ?? [0, 0, run.width, run.height];
  const left = Math.floor(bounds[0] * dpr) - 1;
  const top = Math.floor(bounds[1] * dpr) - 1;
  const width = Math.max(1, Math.ceil((bounds[0] + bounds[2]) * dpr) + 1 - left);
  const height = Math.max(1, Math.ceil((bounds[1] + bounds[3]) * dpr) + 1 - top);
  if (width > 16384 || height > 16384 || width * height > provider.budgets.maxPixels) {
    throw new DrawingError('SFRENDER082', 'Text raster pixel budget exceeded');
  }
  const source = provider.rasterizer.createCanvas(width, height);
  const context = source.getContext('2d', {colorSpace: 'srgb'});
  if (!context) throw new DrawingError('SFRENDER084', 'Text Canvas2D context is unavailable');
  context.setTransform(dpr, 0, 0, dpr, -left, -top);
  paintPortableText(context, run, {provider, ...options, dpr});
  return {source, width, height, logicalWidth: width / dpr, logicalHeight: height / dpr,
    origin: [left / dpr, top / dpr], alphaMode: 'premultiplied', colorSpace: 'srgb'};
}
