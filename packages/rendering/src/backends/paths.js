import {geometryToPath} from '../geometry/path-geometry.js';
import {arcParameters} from '../geometry/curves.js';

/** Append exact path commands, keeping transforms local to each figure and preserving the active path. */
export function traceGeometry(context, geometry, {filledOnly = false} = {}) {
  const path = geometryToPath(geometry);
  context.beginPath();
  context.save();
  if (path.transform) context.transform(...path.transform);
  for (const figure of path.figures) {
    if (filledOnly && figure.filled === false) continue;
    context.save();
    if (figure.transform) context.transform(...figure.transform);
    context.moveTo(...figure.start);
    let current = figure.start;
    for (const segment of figure.segments) {
      if (segment.kind === 'line') context.lineTo(...segment.end);
      else if (segment.kind === 'quadratic') context.quadraticCurveTo(...segment.control, ...segment.end);
      else if (segment.kind === 'cubic') context.bezierCurveTo(...segment.control1, ...segment.control2, ...segment.end);
      else if (segment.kind === 'arc') {
        const arc = arcParameters(current, segment);
        if (arc) context.ellipse(...arc.center, arc.radiusX, arc.radiusY, arc.angle, arc.startAngle, arc.startAngle + arc.sweep, arc.sweep < 0);
        else context.lineTo(...segment.end);
      }
      current = segment.end;
    }
    if (figure.closed) context.closePath();
    context.restore();
  }
  context.restore();
  return path;
}
export function traceContours(context, contours) {
  context.beginPath();
  for (const contour of contours) {
    const points = contour.points;
    if (!points.length) continue;
    context.moveTo(points[0], points[1]);
    for (let index = 2; index < points.length; index += 2) context.lineTo(points[index], points[index + 1]);
    if (contour.closed) context.closePath();
  }
}
