import {normalizeBrush, sampleBrush, brushMatrix} from './brushes.js';
import {DrawingError, resolveResource} from '../drawing/commands.js';
import {imageRectangle, nineGridPatches} from '../media/images.js';
import {evaluateWorkingEffect} from './working-effects.js';
import {cssColor} from '../media/colors.js';

/** Raster policy shared by Canvas/SVG and explicitly reported GPU operation fallbacks. */
export function rasterizeBrush(input, bounds, resources, options, depth = 0) {
  if (depth > 32) throw new DrawingError('SFRENDER104', 'Brush graph exceeds nesting budget');
  const brush = normalizeBrush(input, resources, options.resolve), dpr = options.dpr ?? 1;
  const width = Math.max(1, Math.ceil(bounds[2] * dpr)), height = Math.max(1, Math.ceil(bounds[3] * dpr));
  if (width * height > (options.maxPixels ?? 16777216)) throw new DrawingError('SFRENDER067', 'Brush raster exceeds pixel budget');
  const canvas = options.createCanvas(width, height), context = canvas.getContext('2d', {willReadFrequently: true});
  const nested = (value, area = bounds) => rasterizeBrush(value, area, resources, options, depth + 1);
  const draw = image => context.drawImage(image.source, 0, 0, width, height);
  if (!brush) return {source: canvas, width, height};
  if (['solid', 'linear', 'radial'].includes(brush.kind)) {
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const color = sampleBrush(brush, bounds[0] + (x + 0.5) / dpr, bounds[1] + (y + 0.5) / dpr, bounds);
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) image.data[offset + channel] = Math.round(color[channel] * 255);
    }
    context.putImageData(image, 0, 0);
    return {source: canvas, width, height};
  }
  if (brush.kind === 'image') {
    const image = decodedImage(resolveResource(resources, brush.image, 'image'), options.createCanvas);
    const fit = imageRectangle(image, bounds, brush);
    context.save(); context.setTransform(dpr, 0, 0, dpr, -bounds[0] * dpr, -bounds[1] * dpr);
    context.transform(...brushMatrix(brush, bounds));
    context.imageSmoothingEnabled = brush.sampling !== 'nearest';
    context.drawImage(image.source, ...fit.source, ...fit.destination);
    context.restore();
  } else if (brush.kind === 'nine-grid') {
    if (brush.insets.length !== 4) throw new DrawingError('SFRENDER065', 'Nine-grid requires four insets');
    const sourceBrush = normalizeBrush(brush.source, resources, options.resolve);
    const image = sourceBrush?.kind === 'image' ? decodedImage(resolveResource(resources, sourceBrush.image, 'image'), options.createCanvas) :
      nested(brush.source);
    const destination = [0, 0, width, height], insets = brush.insets.map(value => value * dpr);
    for (const patch of nineGridPatches(image, destination, insets)) {
      if (patch.source[2] && patch.source[3] && patch.destination[2] && patch.destination[3]) {
        context.drawImage(image.source, ...patch.source, ...patch.destination);
      }
    }
  } else if (brush.kind === 'mask') {
    draw(nested(brush.source)); context.globalCompositeOperation = 'destination-in'; draw(nested(brush.mask));
    context.globalCompositeOperation = 'source-over';
  } else if (brush.kind === 'effect') {
    const sources = Object.fromEntries(Object.entries(brush.sources).map(([name, value]) => [name, premultipliedRaster(nested(value))]));
    writePremultiplied(context, evaluateWorkingEffect(brush.graph, sources, {...options, width, height}));
  } else if (brush.kind === 'backdrop' || brush.kind === 'acrylic') {
    const backdrop = brush.alwaysUseFallback ? null : typeof options.backdrop === 'function' ? options.backdrop(bounds, dpr) : options.backdrop;
    if (!backdrop) {
      options.onFallback?.({operation: brush.kind, backend: options.backend ?? 'canvas2d',
        reason: 'No authorized backdrop source is attached; the brush fallback color is used'});
      context.fillStyle = cssColor(brush.fallback); context.fillRect(0, 0, width, height);
    } else {
      draw(decodedImage(backdrop, options.createCanvas));
      if (brush.kind === 'acrylic') {
        const graph = {type: 'Blend', mode: 'SourceOver', sources: [
          {type: 'ColorSource', color: [...brush.tint.slice(0, 3), brush.tint[3] * brush.tintOpacity]},
          {type: 'Saturation', saturation: 1.25, sources: [{type: 'GaussianBlur', blurAmount: Math.min(64, brush.blur),
            sources: [{type: 'Source', name: 'Backdrop'}]}]}
        ]};
        writePremultiplied(context, evaluateWorkingEffect(graph, {Backdrop: premultipliedRaster({source: canvas, width, height})},
          {...options, width, height, dpr: dpr * Math.max(1, brush.blur / 64)}));
        if (brush.luminosityOpacity) {
          context.globalAlpha = brush.luminosityOpacity; context.globalCompositeOperation = 'luminosity';
          context.fillStyle = cssColor(brush.tint); context.fillRect(0, 0, width, height);
          context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
        }
        if (brush.noiseOpacity) {
          const image = context.getImageData(0, 0, width, height);
          for (let index = 0; index < image.data.length; index += 4) {
            const noise = ((((index / 4 + 1) * 1664525 + 1013904223) >>> 0) & 255) - 127.5;
            for (let channel = 0; channel < 3; channel++) image.data[index + channel] += noise * brush.noiseOpacity;
          }
          context.putImageData(image, 0, 0);
        }
      }
    }
  } else throw new DrawingError('SFRENDER052', `Unsupported brush raster ${brush.kind}`);
  if (brush.opacity !== 1) {
    context.globalCompositeOperation = 'destination-in'; context.fillStyle = `rgba(0,0,0,${brush.opacity})`;
    context.fillRect(0, 0, width, height); context.globalCompositeOperation = 'source-over';
  }
  if (['nine-grid', 'mask', 'effect', 'acrylic', 'backdrop'].includes(brush.kind)) {
    const matrix = brushMatrix(brush, bounds);
    if (matrix.some((value, index) => value !== [1, 0, 0, 1, 0, 0][index])) {
      const transformed = options.createCanvas(width, height), target = transformed.getContext('2d');
      target.setTransform(dpr, 0, 0, dpr, -bounds[0] * dpr, -bounds[1] * dpr); target.transform(...matrix);
      target.drawImage(canvas, ...bounds); canvas.width = canvas.height = 0;
      return {source: transformed, width, height};
    }
  }
  return {source: canvas, width, height};
}

export function decodedImage(image, createCanvas) {
  if (!image) throw new DrawingError('SFRENDER066', 'A decoded image resource is required');
  if (image.source) return image;
  if (image.getContext) return {source: image, width: image.width, height: image.height};
  if (!image.pixels) throw new DrawingError('SFRENDER066', 'A decoded image resource is required');
  const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
  const data = context.createImageData(image.width, image.height); data.data.set(image.pixels); context.putImageData(data, 0, 0);
  return {...image, source: canvas};
}

export function premultipliedRaster(image) {
  const values = image.source.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, image.width, image.height).data;
  const data = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 4) {
    const alpha = values[index + 3] / 255; data[index + 3] = alpha;
    for (let channel = 0; channel < 3; channel++) data[index + channel] = values[index + channel] / 255 * alpha;
  }
  return {width: image.width, height: image.height, data};
}

export function writePremultiplied(context, raster) {
  const image = context.createImageData(raster.width, raster.height);
  for (let index = 0; index < raster.data.length; index += 4) {
    const alpha = raster.data[index + 3]; image.data[index + 3] = Math.round(alpha * 255);
    for (let channel = 0; channel < 3; channel++) image.data[index + channel] = alpha ? Math.round(raster.data[index + channel] / alpha * 255) : 0;
  }
  context.putImageData(image, 0, 0);
}
