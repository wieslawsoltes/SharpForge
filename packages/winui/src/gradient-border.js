import {gradientPaint, gradientSvgDocument} from './gradient-svg.js';

const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;

function normalizedCorners({width, height}, corners) {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const ratio = (available, sum) => sum ? available / sum : 1;
  const ratios = [1, ratio(width, topLeft[0] + topRight[0]), ratio(width, bottomLeft[0] + bottomRight[0]),
    ratio(height, topLeft[1] + bottomLeft[1]), ratio(height, topRight[1] + bottomRight[1])];
  const factor = Math.min(...ratios);
  return corners.map(pair => pair.map(value => value * factor));
}

function roundedPath(box, corners) {
  const {x = 0, y = 0, width, height} = box;
  const [a, b, c, d] = normalizedCorners(box, corners);
  const right = x + width;
  const bottom = y + height;
  return `M${x + a[0]} ${y}H${right - b[0]}A${b[0]} ${b[1]} 0 0 1 ${right} ${y + b[1]}` +
    `V${bottom - c[1]}A${c[0]} ${c[1]} 0 0 1 ${right - c[0]} ${bottom}` +
    `H${x + d[0]}A${d[0]} ${d[1]} 0 0 1 ${x} ${bottom - d[1]}` +
    `V${y + a[1]}A${a[0]} ${a[1]} 0 0 1 ${x + a[0]} ${y}Z`;
}

/** Render a brush-filled border ring with four independent thicknesses and CSS-normalized corner radii. */
export function gradientBorderSvg(properties, box) {
  const thickness = properties.BorderThickness ?? {};
  const left = Math.min(box.width, nonnegative(thickness.Left));
  const top = Math.min(box.height, nonnegative(thickness.Top));
  const right = Math.min(box.width - left, nonnegative(thickness.Right));
  const bottom = Math.min(box.height - top, nonnegative(thickness.Bottom));
  const radius = properties.CornerRadius ?? {};
  const radii = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(key => nonnegative(radius[key]));
  const corners = normalizedCorners(box, radii.map(value => [value, value]));
  const reductions = [[left, top], [right, top], [right, bottom], [left, bottom]];
  const innerCorners = corners.map((pair, index) => pair.map((value, axis) => Math.max(0, value - reductions[index][axis])));
  const inner = {x: left, y: top, width: box.width - left - right, height: box.height - top - bottom};
  const outerPath = roundedPath(box, corners);
  const innerPath = roundedPath(inner, innerCorners);
  const brush = gradientPaint(properties.BorderBrush, 'border', box);
  return gradientSvgDocument(box, brush.definition,
    `<path d="${outerPath}${innerPath}" fill="${brush.paint}" fill-rule="evenodd"/>`);
}
