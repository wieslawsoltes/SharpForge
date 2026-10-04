import { ControlError } from '../policy/events.js';

function bounded(value, minimum, maximum) {
  if (!Number.isFinite(value)) throw new ControlError('SFUI1689', 'Color channels must be finite');
  return Math.max(minimum, Math.min(maximum, value));
}

export function colorFromHex(value, alpha = 255) {
  if (typeof value !== 'string' || !/^#?(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    throw new ControlError('SFUI1689', 'Color requires six RGB or eight ARGB hexadecimal digits');
  }
  const text = value.replace(/^#/, '');
  const start = text.length === 8 ? 2 : 0;
  return { A: text.length === 8 ? parseInt(text.slice(0, 2), 16) : bounded(alpha, 0, 255),
    R: parseInt(text.slice(start, start + 2), 16), G: parseInt(text.slice(start + 2, start + 4), 16), B: parseInt(text.slice(start + 4), 16) };
}

export function colorToHex(color, includeAlpha = false) {
  return '#' + (includeAlpha ? ['A', 'R', 'G', 'B'] : ['R', 'G', 'B']).map(channel =>
    Math.round(bounded(color?.[channel] ?? (channel === 'A' ? 255 : 0), 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbToHsv(color) {
  const [r, g, b] = ['R', 'G', 'B'].map(channel => bounded(color[channel], 0, 255) / 255);
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), difference = maximum - minimum;
  let hue = !difference ? 0 : maximum === r ? (g - b) / difference % 6 : maximum === g ? (b - r) / difference + 2 : (r - g) / difference + 4;
  hue = (hue * 60 + 360) % 360;
  return { H: hue, S: maximum ? difference / maximum * 100 : 0, V: maximum * 100 };
}

export function hsvToRgb(hsv, alpha = 255) {
  const hue = bounded(hsv.H, 0, 360) % 360, saturation = bounded(hsv.S, 0, 100) / 100, value = bounded(hsv.V, 0, 100) / 100;
  const chroma = value * saturation, x = chroma * (1 - Math.abs(hue / 60 % 2 - 1)), offset = value - chroma;
  const channels = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x]
    : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { A: Math.round(bounded(alpha, 0, 255)), R: Math.round((channels[0] + offset) * 255),
    G: Math.round((channels[1] + offset) * 255), B: Math.round((channels[2] + offset) * 255) };
}

export function constrainHsv(value, properties) {
  const result = {};
  for (const [channel, name, fallback] of [['H', 'Hue', 359], ['S', 'Saturation', 100], ['V', 'Value', 100]]) {
    const minimum = properties['Min' + name] ?? 0, maximum = properties['Max' + name] ?? fallback;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum > fallback || minimum > maximum) {
      throw new ControlError('SFUI1689', 'Invalid color channel limits');
    }
    result[channel] = bounded(value[channel], minimum, maximum);
  }
  return result;
}
