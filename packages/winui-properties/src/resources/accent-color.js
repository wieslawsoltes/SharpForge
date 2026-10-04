import {ResourceFault} from './errors.js';

const systemKeys = Object.freeze([
  'SystemAccentColorDark3', 'SystemAccentColorDark2', 'SystemAccentColorDark1', 'SystemAccentColor',
  'SystemAccentColorLight1', 'SystemAccentColorLight2', 'SystemAccentColorLight3'
]);

function linear(channel) {
  channel /= 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function encoded(channel) {
  const value = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, value)) * 255).toString(16).padStart(2, '0');
}

/** Parse a CSS RGB accent; ARGB transparency is intentionally forbidden for system accents. */
export function parseAccent(accent) {
  if (!/^#[\da-f]{6}$/i.test(accent)) throw new ResourceFault('SFRES016', 'An accent must be an opaque #RRGGBB color.');
  return [1, 3, 5].map(index => parseInt(accent.slice(index, index + 2), 16));
}

/**
 * Deterministic linear-sRGB tonal ramp. A host may supply the seven actual UISettings colors;
 * the browser fallback does not claim to reproduce the proprietary Windows accent algorithm.
 */
export function createAccentRamp(accent = '#0078d4', {systemRamp = null} = {}) {
  const channels = parseAccent(accent).map(linear);
  if (systemRamp) {
    const result = {};
    for (const key of systemKeys) {
      parseAccent(systemRamp[key]);
      result[key] = systemRamp[key].toLowerCase();
    }
    return Object.freeze(result);
  }
  const shades = [-0.8, -0.6, -0.35, 0, 0.25, 0.5, 0.75];
  const result = {};
  for (let index = 0; index < shades.length; index++) {
    const amount = shades[index];
    result[systemKeys[index]] = '#' + channels.map(channel => encoded(
      amount < 0 ? channel * (1 + amount) : channel + (1 - channel) * amount
    )).join('');
  }
  return Object.freeze(result);
}

/** XAML #AARRGGBB colors become CSS #RRGGBBAA; system colors are passed through. */
export function xamlColorToCss(color) {
  if (/^#[\da-f]{8}$/i.test(color)) return '#' + color.slice(3) + color.slice(1, 3);
  if (/^#[\da-f]{4}$/i.test(color)) return '#' + color.slice(2) + color.slice(1, 2);
  return color;
}
