import {srgbToLinear, linearToSrgb} from './colors.js';
import {DrawingError} from '../drawing/commands.js';

export function blendColorSpace(value = 'srgb') {
  if (!['srgb', 'linear'].includes(value)) throw new DrawingError('SFRENDER139', 'Blend color space must be srgb or linear');
  return value;
}

/** Convert straight sRGB byte pixels to normalized, premultiplied linear light. */
export function decodeSrgbPixels(bytes, output = new Float32Array(bytes.length)) {
  for (let index = 0; index < bytes.length; index += 4) {
    const alpha = bytes[index + 3] / 255; output[index + 3] = alpha;
    for (let channel = 0; channel < 3; channel++) output[index + channel] = srgbToLinear(bytes[index + channel] / 255) * alpha;
  }
  return output;
}

/** Encode normalized, premultiplied linear light to sRGB bytes with an explicit alpha convention. */
export function encodeSrgbPixels(values, {premultiplied = false, output = new Uint8ClampedArray(values.length)} = {}) {
  for (let index = 0; index < values.length; index += 4) {
    const alpha = Math.max(0, Math.min(1, values[index + 3])); output[index + 3] = Math.round(alpha * 255);
    for (let channel = 0; channel < 3; channel++) {
      const linear = alpha ? Math.max(0, Math.min(1, values[index + channel] / alpha)) : 0;
      output[index + channel] = Math.round(linearToSrgb(linear) * (premultiplied ? alpha : 1) * 255);
    }
  }
  return output;
}

/** In-place source-over in the chosen working light space; optional mask is straight alpha bytes. */
export function compositeLinear(source, destination, opacity = 1, mask = null) {
  for (let index = 0; index < source.length; index += 4) {
    const coverage = opacity * (mask ? mask[index + 3] / 255 : 1), alpha = source[index + 3] * coverage;
    for (let channel = 0; channel < 4; channel++) {
      destination[index + channel] = source[index + channel] * coverage + destination[index + channel] * (1 - alpha);
    }
  }
  return destination;
}

/** IEEE binary16 decode used only by explicit GPU readback from linear rgba16float targets. */
export function halfToNumber(bits) {
  const sign = bits & 0x8000 ? -1 : 1, exponent = bits >>> 10 & 31, fraction = bits & 1023;
  if (!exponent) return sign * fraction * 2 ** -24;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}
