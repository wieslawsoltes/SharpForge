import {DrawingError, finite} from '../drawing/commands.js';

/** Backends share one DIP-to-pixel contract, including downsampling and device-specific allocation limits. */
export function renderViewport(options, {width = 1, height = 1, maxPixels = 16777216, maxDimension = 16384} = {}) {
  width = Math.max(1, finite(options.width ?? width, 'render width', 0, 1000000));
  height = Math.max(1, finite(options.height ?? height, 'render height', 0, 1000000));
  const dpr = finite(options.dpr ?? 1, 'render pixel scale', 0.000001, 8);
  const pixelWidth = Math.max(1, Math.ceil(width * dpr)), pixelHeight = Math.max(1, Math.ceil(height * dpr));
  if (pixelWidth * pixelHeight > maxPixels || pixelWidth > maxDimension || pixelHeight > maxDimension) {
    throw new DrawingError('SFRENDER092', 'Render target exceeds pixel or device dimension limits');
  }
  return {width, height, dpr, pixelWidth, pixelHeight};
}
