import {normalizeLinearGradientBrush, gradientNumber, isLinearGradient} from './gradient-data.js';
import {cssColor} from './surface.js';

const color = value => `rgb(${value.R},${value.G},${value.B})`;

/** Build numeric-only SVG paint definitions. The axis uses physical pixels, preserving non-square/off-center geometry. */
export function gradientPaint(value, id, box) {
  if (!isLinearGradient(value)) return {paint: cssColor(value), definition: ''};
  const brush = normalizeLinearGradientBrush(value);
  const stops = brush.GradientStops;
  if (!stops.length) return {paint: 'transparent', definition: ''};
  const last = stops.at(-1).Color;
  if (stops.length === 1 || brush.StartPoint.X === brush.EndPoint.X && brush.StartPoint.Y === brush.EndPoint.Y) {
    return {paint: `rgba(${last.R},${last.G},${last.B},${last.A / 255 * brush.Opacity})`, definition: ''};
  }
  const start = brush.StartPoint;
  const end = brush.EndPoint;
  const axis = `x1="${start.X * box.width}" y1="${start.Y * box.height}" x2="${end.X * box.width}" y2="${end.Y * box.height}"`;
  const values = stops.map(stop =>
    `<stop offset="${stop.Offset}" stop-color="${color(stop.Color)}" stop-opacity="${stop.Color.A / 255 * brush.Opacity}"/>`).join('');
  return {paint: `url(#${id})`, definition:
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ${axis} spreadMethod="pad" color-interpolation="sRGB">` +
    values + '</linearGradient>'};
}

export function gradientSvgDocument(box, definitions, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" ` +
    `viewBox="0 0 ${box.width} ${box.height}"><defs>${definitions}</defs>${body}</svg>`;
}

export const gradientSvgImage = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Return a safe standalone SVG for the portable gradient profile at a finite CSS-pixel size; invalid records throw SFUI_GRADIENT. */
export function linearGradientSvg(brush, {width, height}) {
  const box = {
    width: gradientNumber(width, 0, 100000, 'Width'), height: gradientNumber(height, 0, 100000, 'Height')
  };
  const paint = gradientPaint(normalizeLinearGradientBrush(brush), 'paint', box);
  return gradientSvgDocument(box, paint.definition, `<rect width="100%" height="100%" fill="${paint.paint}"/>`);
}
