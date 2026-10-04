import {DrawingError, finite} from '../drawing/commands.js';

const namedHex = {
  AliceBlue:'f0f8ff', AntiqueWhite:'faebd7', Aqua:'00ffff', Aquamarine:'7fffd4', Azure:'f0ffff', Beige:'f5f5dc', Bisque:'ffe4c4',
  Black:'000000', BlanchedAlmond:'ffebcd', Blue:'0000ff', BlueViolet:'8a2be2', Brown:'a52a2a', BurlyWood:'deb887',
  CadetBlue:'5f9ea0', Chartreuse:'7fff00', Chocolate:'d2691e', Coral:'ff7f50', CornflowerBlue:'6495ed', Cornsilk:'fff8dc',
  Crimson:'dc143c', Cyan:'00ffff', DarkBlue:'00008b', DarkCyan:'008b8b', DarkGoldenrod:'b8860b', DarkGray:'a9a9a9',
  DarkGreen:'006400', DarkKhaki:'bdb76b', DarkMagenta:'8b008b', DarkOliveGreen:'556b2f', DarkOrange:'ff8c00', DarkOrchid:'9932cc',
  DarkRed:'8b0000', DarkSalmon:'e9967a', DarkSeaGreen:'8fbc8f', DarkSlateBlue:'483d8b', DarkSlateGray:'2f4f4f', DarkTurquoise:'00ced1',
  DarkViolet:'9400d3', DeepPink:'ff1493', DeepSkyBlue:'00bfff', DimGray:'696969', DodgerBlue:'1e90ff', Firebrick:'b22222',
  FloralWhite:'fffaf0', ForestGreen:'228b22', Fuchsia:'ff00ff', Gainsboro:'dcdcdc', GhostWhite:'f8f8ff', Gold:'ffd700',
  Goldenrod:'daa520', Gray:'808080', Green:'008000', GreenYellow:'adff2f', Honeydew:'f0fff0', HotPink:'ff69b4', IndianRed:'cd5c5c',
  Indigo:'4b0082', Ivory:'fffff0', Khaki:'f0e68c', Lavender:'e6e6fa', LavenderBlush:'fff0f5', LawnGreen:'7cfc00',
  LemonChiffon:'fffacd', LightBlue:'add8e6', LightCoral:'f08080', LightCyan:'e0ffff', LightGoldenrodYellow:'fafad2', LightGray:'d3d3d3',
  LightGreen:'90ee90', LightPink:'ffb6c1', LightSalmon:'ffa07a', LightSeaGreen:'20b2aa', LightSkyBlue:'87cefa', LightSlateGray:'778899',
  LightSteelBlue:'b0c4de', LightYellow:'ffffe0', Lime:'00ff00', LimeGreen:'32cd32', Linen:'faf0e6', Magenta:'ff00ff',
  Maroon:'800000', MediumAquamarine:'66cdaa', MediumBlue:'0000cd', MediumOrchid:'ba55d3', MediumPurple:'9370db',
  MediumSeaGreen:'3cb371', MediumSlateBlue:'7b68ee', MediumSpringGreen:'00fa9a', MediumTurquoise:'48d1cc', MediumVioletRed:'c71585',
  MidnightBlue:'191970', MintCream:'f5fffa', MistyRose:'ffe4e1', Moccasin:'ffe4b5', NavajoWhite:'ffdead', Navy:'000080',
  OldLace:'fdf5e6', Olive:'808000', OliveDrab:'6b8e23', Orange:'ffa500', OrangeRed:'ff4500', Orchid:'da70d6', PaleGoldenrod:'eee8aa',
  PaleGreen:'98fb98', PaleTurquoise:'afeeee', PaleVioletRed:'db7093', PapayaWhip:'ffefd5', PeachPuff:'ffdab9', Peru:'cd853f',
  Pink:'ffc0cb', Plum:'dda0dd', PowderBlue:'b0e0e6', Purple:'800080', Red:'ff0000', RosyBrown:'bc8f8f', RoyalBlue:'4169e1',
  SaddleBrown:'8b4513', Salmon:'fa8072', SandyBrown:'f4a460', SeaGreen:'2e8b57', SeaShell:'fff5ee', Sienna:'a0522d', Silver:'c0c0c0',
  SkyBlue:'87ceeb', SlateBlue:'6a5acd', SlateGray:'708090', Snow:'fffafa', SpringGreen:'00ff7f', SteelBlue:'4682b4', Tan:'d2b48c',
  Teal:'008080', Thistle:'d8bfd8', Tomato:'ff6347', Turquoise:'40e0d0', Violet:'ee82ee', Wheat:'f5deb3', White:'ffffff',
  WhiteSmoke:'f5f5f5', Yellow:'ffff00', YellowGreen:'9acd32'
};

export function colorFromArgb(alpha, red, green, blue) {
  for (const channel of [alpha, red, green, blue]) {
    finite(channel, 'color channel', 0, 255);
    if (!Number.isInteger(channel)) throw new DrawingError('SFRENDER050', 'ARGB channels must be integers');
  }
  return Object.freeze({valueType: 'Windows.UI.Color', A: alpha, R: red, G: green, B: blue});
}
export const Colors = Object.freeze(Object.fromEntries([
  ...Object.entries(namedHex).map(([name, value]) => [name, colorFromArgb(255, parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16), parseInt(value.slice(4), 16))]), ['Transparent', colorFromArgb(0, 255, 255, 255)]
]));
const names = new Map(Object.entries(Colors).map(([name, value]) => [name.toLowerCase(), value]));

/** Parse XAML #ARGB/#AARRGGBB, CSS rgb(a), named colors, typed colors and normalized channel arrays. */
export function parseColor(value) {
  if (value == null) return [0, 0, 0, 0];
  if (value?.valueType?.endsWith('.SolidColorBrush')) {
    const color = parseColor(value.Color); color[3] *= value.Opacity ?? 1; return color;
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (value.length !== 4) throw new DrawingError('SFRENDER050', 'Color needs four normalized channels');
    return Array.from(value, channel => finite(channel, 'color channel', 0, 1));
  }
  if (typeof value === 'object' && 'R' in value) {
    const validated = colorFromArgb(value.A, value.R, value.G, value.B);
    return [validated.R / 255, validated.G / 255, validated.B / 255, validated.A / 255];
  }
  if (typeof value !== 'string') throw new DrawingError('SFRENDER050', 'Unsupported color value');
  const text = value.trim().toLowerCase(), named = names.get(text);
  if (named) return parseColor(named);
  if (text === 'transparent') return [0, 0, 0, 0];
  if (/^#[\da-f]{3,8}$/i.test(text)) {
    let hex = text.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(character => character + character).join('');
    if (hex.length !== 6 && hex.length !== 8) throw new DrawingError('SFRENDER050', 'Hex colors require 3, 4, 6 or 8 digits');
    const hasAlpha = hex.length === 8, at = hasAlpha ? 2 : 0;
    return [parseInt(hex.slice(at, at + 2), 16) / 255, parseInt(hex.slice(at + 2, at + 4), 16) / 255,
      parseInt(hex.slice(at + 4, at + 6), 16) / 255, hasAlpha ? parseInt(hex.slice(0, 2), 16) / 255 : 1];
  }
  const match = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(text);
  if (match) return [finite(+match[1], 'red', 0, 255) / 255, finite(+match[2], 'green', 0, 255) / 255,
    finite(+match[3], 'blue', 0, 255) / 255, finite(+(match[4] ?? 1), 'alpha', 0, 1)];
  throw new DrawingError('SFRENDER050', `Unknown color ${value}`);
}
export function cssColor(value) {
  const [red, green, blue, alpha] = parseColor(value);
  return `rgba(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)},${alpha})`;
}
export function colorEquals(left, right) { const a = parseColor(left), b = parseColor(right); return a.every((value, index) => value === b[index]); }
export const srgbToLinear = value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = value => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
export function premultiply(value) { const [r, g, b, a] = parseColor(value); return [r * a, g * a, b * a, a]; }
export function colorDisplayName(value) {
  for (const [name, color] of Object.entries(Colors)) if (colorEquals(value, color)) return name;
  const [r, g, b, a] = parseColor(value).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0'));
  return `#${a}${r}${g}${b}`.toUpperCase();
}
