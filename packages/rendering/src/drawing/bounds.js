import {DrawOp, resolveResource, DrawingError} from './commands.js';
import {geometryBounds} from '../geometry/geometry-math.js';
import {normalizeGeometry, LineGeometry} from '../geometry/path-geometry.js';
import {normalizePen} from '../geometry/stroke.js';
import {IDENTITY, multiply, transformBounds} from '../media/transforms.js';
import {shadowBounds} from '../brushes/shadows.js';

const union = (left, right) => {
  if (!left) return [...right];
  const x = Math.min(left[0], right[0]), y = Math.min(left[1], right[1]);
  return [x, y, Math.max(left[0] + left[2], right[0] + right[2]) - x,
    Math.max(left[1] + left[3], right[1] + right[3]) - y];
};

/** Conservative painted bounds reserve enough surface for overflowing strokes, focus rings and layer effects. */
export function displayListBounds(list, resources, {resolve, transform = IDENTITY, depth = 0} = {}) {
  if (depth > 64) throw new DrawingError('SFRENDER136', 'Display-list layer bounds nesting limit');
  let result = list.bounds ? transformBounds(transform, list.bounds) : null, current = transform;
  const stack = [];
  for (const command of list.commands) {
    if (command.op === DrawOp.PushTransform) { stack.push(current); current = multiply(current, command.transform); continue; }
    if (command.op === DrawOp.PushClip || command.op === DrawOp.PushOpacity) { stack.push(current); continue; }
    if (command.op === DrawOp.Pop) { current = stack.pop(); continue; }
    let bounds = null;
    if (command.op === DrawOp.Image) bounds = command.destination;
    else if (command.op === DrawOp.GlyphRun) {
      const run = resolveResource(resources, command.run, 'glyphRun'), ink = run.inkBounds ?? [0, 0, run.width, run.height];
      bounds = [command.origin[0] + ink[0], command.origin[1] + ink[1], ink[2], ink[3]];
    } else if (command.op === DrawOp.Layer) {
      const layer = resolveResource(resources, command.layer, 'layer');
      if (layer.displayList) {
        bounds = displayListBounds(layer.displayList, resources, {resolve, depth: depth + 1});
        const graph = command.options?.effect ?? layer.effect;
        const blur = effectOutset(graph);
        if (blur) bounds = [bounds[0] - blur, bounds[1] - blur, bounds[2] + blur * 2, bounds[3] + blur * 2];
        bounds = shadowBounds(bounds, command.options?.shadow ?? layer.shadow);
        bounds = transformBounds(command.options?.transform ?? layer.transform ?? IDENTITY, bounds);
      }
    } else if (command.op >= DrawOp.Rectangle && command.op <= DrawOp.Geometry) {
      const geometry = command.op === DrawOp.Geometry ? normalizeGeometry(resolveResource(resources, command.geometry, 'geometry'), resolve) :
        command.op === DrawOp.Line ? new LineGeometry(command.start, command.end) :
          {kind: command.op === DrawOp.Ellipse ? 'ellipse' : 'rectangle', rect: command.rect, radii: command.radii};
      bounds = geometryBounds(geometry);
      const pen = normalizePen(resolveResource(resources, command.pen, 'pen'));
      if (pen?.width) {
        const outset = pen.width / 2 * (pen.join === 'miter' ? Math.min(20, pen.miterLimit) : 1);
        bounds = [bounds[0] - outset, bounds[1] - outset, bounds[2] + outset * 2, bounds[3] + outset * 2];
      }
    }
    if (bounds) result = union(result, transformBounds(current, bounds));
  }
  return result ?? [0, 0, 0, 0];
}

function effectOutset(graph, depth = 0) {
  if (!graph || depth > 32) return 0;
  return (graph.type === 'GaussianBlur' ? (graph.blurAmount ?? 0) * 3 : 0) +
    Math.max(0, ...(graph.sources ?? []).map(source => effectOutset(source, depth + 1)));
}
