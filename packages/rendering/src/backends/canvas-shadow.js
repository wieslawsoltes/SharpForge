import {normalizeShadow} from '../brushes/shadows.js';
import {rasterizeBrush, premultipliedRaster, writePremultiplied} from '../brushes/rasterizer.js';
import {evaluateEffect} from '../composition/effects.js';
import {cssColor} from '../media/colors.js';
import {decodeSrgbPixels, encodeSrgbPixels, compositeLinear} from '../media/working-color.js';

/** Colorize an alpha mask, blur in physical pixels, offset, then composite the original layer on top. */
export function paintCanvasShadow(canvas, input, resources, {createCanvas, bounds, contentBounds, dpr = 1, ...options}) {
  const shadow = normalizeShadow(input);
  if (!shadow?.opacity) return;
  const mask = createCanvas(canvas.width, canvas.height), context = mask.getContext('2d');
  if (shadow.mask) {
    const area = contentBounds ?? bounds;
    const image = rasterizeBrush(shadow.mask, area, resources, {...options, dpr, createCanvas});
    context.drawImage(image.source, (area[0] - bounds[0]) * dpr, (area[1] - bounds[1]) * dpr);
    image.source.width = image.source.height = 0;
  } else context.drawImage(canvas, 0, 0);
  const color = [...shadow.color]; color[3] *= shadow.opacity;
  context.globalCompositeOperation = 'source-in'; context.fillStyle = cssColor(color);
  context.fillRect(0, 0, mask.width, mask.height); context.globalCompositeOperation = 'source-over';
  const combined = createCanvas(canvas.width, canvas.height), output = combined.getContext('2d');
  if (shadow.blurRadius && typeof output.filter === 'string') {
    output.filter = `blur(${shadow.blurRadius * dpr}px)`;
    output.drawImage(mask, shadow.offset[0] * dpr, shadow.offset[1] * dpr);
    output.filter = 'none';
  } else if (shadow.blurRadius) {
    const amount = Math.min(64, shadow.blurRadius);
    const blurred = evaluateEffect({type: 'GaussianBlur', blurAmount: amount, sources: [{type: 'Source', name: 'mask'}]},
      {mask: premultipliedRaster({source: mask, width: mask.width, height: mask.height})},
      {width: mask.width, height: mask.height, dpr: dpr * shadow.blurRadius / amount});
    writePremultiplied(context, blurred);
    output.drawImage(mask, shadow.offset[0] * dpr, shadow.offset[1] * dpr);
  } else output.drawImage(mask, shadow.offset[0] * dpr, shadow.offset[1] * dpr);
  if ((options.layerBlendColorSpace ?? options.blendColorSpace) === 'linear') {
    const image = output.getImageData(0, 0, canvas.width, canvas.height);
    const target = decodeSrgbPixels(image.data), source = decodeSrgbPixels(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data);
    encodeSrgbPixels(compositeLinear(source, target), {output: image.data}); output.putImageData(image, 0, 0);
  } else output.drawImage(canvas, 0, 0);
  const target = canvas.getContext('2d'); target.save(); target.setTransform(1, 0, 0, 1, 0, 0);
  target.clearRect(0, 0, canvas.width, canvas.height); target.drawImage(combined, 0, 0); target.restore();
  mask.width = mask.height = combined.width = combined.height = 0;
}
