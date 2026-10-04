import {DrawOp, resolveResource} from '../drawing/commands.js';
import {normalizeBrush} from '../brushes/brushes.js';
import {normalizePen} from '../geometry/stroke.js';

/** Solid rectangles/roundrects/ellipses pack one instance each; complex strokes remain on the general geometry path. */
export function analyticInstance(command, transform, resources, options, texture) {
  if (![DrawOp.Rectangle, DrawOp.RoundedRectangle, DrawOp.Ellipse].includes(command.op)) return null;
  const fill = normalizeBrush(command.brush, resources, options.resolve), pen = normalizePen(resolveResource(resources, command.pen, 'pen'));
  const stroke = pen?.width ? normalizeBrush(pen.brush, resources, options.resolve) : null;
  if (fill && fill.kind !== 'solid' || stroke && stroke.kind !== 'solid' || pen?.dash.length || pen && pen.join !== 'miter') return null;
  const [x, y, width, height] = command.rect;
  if (!width || !height) return {data: new Float32Array(), count: 0, texture, kind: 'analytic'};
  const data = options.instanceData ?? new Float32Array(32), radii = command.radii ?? Array(8).fill(0);
  data.fill(0);
  if (radii.some((radius, index) => radius > (index % 2 ? height : width) / 2)) return null;
  const minScale = Math.abs(transform[0] * transform[3] - transform[1] * transform[2]) /
    Math.max(1e-9, Math.hypot(transform[0], transform[1], transform[2], transform[3]));
  data.set([x, y, width, height]);
  data.set([radii[0], radii[2], radii[4], radii[6]], 4); data.set([radii[1], radii[3], radii[5], radii[7]], 8);
  if (fill) data.set([...fill.color.slice(0, 3), fill.color[3] * fill.opacity], 12);
  if (stroke) data.set([...stroke.color.slice(0, 3), stroke.color[3] * stroke.opacity], 16);
  data.set(transform.slice(0, 4), 20); data.set([transform[4], transform[5], pen?.width ?? 0, command.op === DrawOp.Ellipse ? 1 : 0], 24);
  data[28] = Math.min(1000000, 2 / Math.max(1e-6, minScale * options.dpr));
  return {data, count: 1, texture, kind: 'analytic'};
}
