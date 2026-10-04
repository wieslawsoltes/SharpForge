import {DrawingContext} from '../drawing/context.js';
import {trimGeometry} from './trim-geometry.js';

function shapeTransform(shape) {
  const cosine = Math.cos(shape.RotationAngle);
  const sine = Math.sin(shape.RotationAngle);
  return [cosine * shape.Scale[0], sine * shape.Scale[0], -sine * shape.Scale[1], cosine * shape.Scale[1], ...shape.Offset];
}

function drawShape(context, shape, compositor, depth = 0) {
  if (depth > 64) throw new RangeError('Composition shape depth limit exceeded');
  context.PushTransform(shapeTransform(shape));
  if (shape.Shapes) {
    for (const child of shape.Shapes) drawShape(context, child, compositor, depth + 1);
  } else if (shape.Geometry) {
    const source = shape.Geometry;
    const geometry = source.TrimStart === 0 && source.TrimEnd === 1
      ? compositor.resource(source, 'geometry') : trimGeometry(source.descriptor(), source.trim());
    const pen = shape.StrokeBrush ? {
      brush: compositor.resource(shape.StrokeBrush, 'brush'), thickness: shape.StrokeThickness,
      dashArray: [...shape.StrokeDashArray], dashOffset: shape.StrokeDashOffset, miterLimit: shape.StrokeMiterLimit,
      startCap: shape.StrokeStartCap, endCap: shape.StrokeEndCap, dashCap: shape.StrokeDashCap, lineJoin: shape.StrokeLineJoin
    } : null;
    context.DrawGeometry(geometry, shape.FillBrush ? compositor.resource(shape.FillBrush, 'brush') : null, pen);
  }
  context.Pop();
}

export function encodeCompositionContent(visual, compositor) {
  const context = new DrawingContext({elementId: `composition:${visual.id}`, version: visual.contentVersion});
  if (visual.Brush) context.DrawRectangle([0, 0, ...visual.Size], compositor.resource(visual.Brush, 'brush'));
  if (visual.Shapes) for (const shape of visual.Shapes) drawShape(context, shape, compositor);
  return context.finish([0, 0, ...visual.Size]);
}

/** Layer updates retain the already encoded content packet and painter order. */
export function encodeCompositionLayers(layers) {
  const context = new DrawingContext();
  const draw = layer => {
    context.PushTransform(layer.transform);
    if (layer.opacity !== 1) context.PushOpacity(layer.opacity);
    if (layer.clip) context.PushClip(layer.clip);
    if (layer.displayList?.commands.length) context.DrawLayer(layer.resource ?? {displayList: layer.displayList, cacheKey: 'composition:' + layer.id,
      contentVersion: layer.displayList.version, bounds: layer.displayList.bounds});
    for (const child of layer.children) draw(child);
    if (layer.clip) context.Pop();
    if (layer.opacity !== 1) context.Pop();
    context.Pop();
  };
  for (const layer of layers) draw(layer);
  return context.finish();
}
