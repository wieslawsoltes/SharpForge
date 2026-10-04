import {DrawingError, finite} from '../drawing/commands.js';
import {paintTextLayout} from './rich-text.js';
import {cssColor} from '../media/colors.js';

/** Rasterize intact native runs identically in a document or worker canvas, including overhang and color glyphs. */
export function rasterizeNativeText(run, {createCanvas, maxPixels, provider},
  {dpr = 1, color = '#000000', overrideColors = false, paint = null} = {}) {
  finite(dpr, 'text raster density', 0.01, 64);
  const bounds = run.inkBounds ?? [0, 0, run.width, run.height], origin = [bounds[0] - 1 / dpr, bounds[1] - 1 / dpr];
  const width = Math.max(1, Math.ceil(bounds[2] * dpr + 2)), height = Math.max(1, Math.ceil(bounds[3] * dpr + 2));
  if (width * height > maxPixels) throw new DrawingError('SFRENDER082', 'Text raster exceeds pixel budget');
  const canvas = createCanvas(width, height), context = canvas.getContext('2d');
  if (!context) throw new DrawingError('SFRENDER084', 'Native text rasterization is unavailable');
  context.scale(dpr, dpr); context.translate(-origin[0], -origin[1]);
  paintTextLayout(context, run, {dpr, overrideColors, paint: value => paint ? paint(value, context) : value == null ? color : cssColor(value)});
  return {kind: 'image', source: canvas, width, height, logicalWidth: width / dpr, logicalHeight: height / dpr,
    origin, alphaMode: 'premultiplied', colorSpace: 'srgb', version: run.version, provider};
}
