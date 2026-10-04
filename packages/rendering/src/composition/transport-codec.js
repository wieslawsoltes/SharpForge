import {CompositionEffectBrush} from './effects.js';
import {validateGraphReferences, prepareGraphChanges, commitGraphChanges} from './transport-graph.js';
import {encodeCompositionValue, decodeCompositionValue} from './transport-value.js';

export {encodeCompositionValue, decodeCompositionValue} from './transport-value.js';

const factories = Object.freeze({
  DropShadow: 'CreateDropShadow',
  ContainerVisual: 'CreateContainerVisual', SpriteVisual: 'CreateSpriteVisual', ShapeVisual: 'CreateShapeVisual', LayerVisual: 'CreateLayerVisual',
  CompositionPropertySet: 'CreatePropertySet', CompositionColorBrush: 'CreateColorBrush',
  CompositionLinearGradientBrush: 'CreateLinearGradientBrush', CompositionRadialGradientBrush: 'CreateRadialGradientBrush',
  CompositionColorGradientStop: 'CreateColorGradientStop', CompositionSurfaceBrush: 'CreateSurfaceBrush',
  CompositionNineGridBrush: 'CreateNineGridBrush', CompositionBackdropBrush: 'CreateBackdropBrush', CompositionMaskBrush: 'CreateMaskBrush',
  CompositionRectangleGeometry: 'CreateRectangleGeometry', CompositionRoundedRectangleGeometry: 'CreateRoundedRectangleGeometry',
  CompositionEllipseGeometry: 'CreateEllipseGeometry', CompositionLineGeometry: 'CreateLineGeometry',
  CompositionPathGeometry: 'CreatePathGeometry', CompositionSpriteShape: 'CreateSpriteShape', CompositionContainerShape: 'CreateContainerShape',
  InsetClip: 'CreateInsetClip', RectangleClip: 'CreateRectangleClip', GeometricClip: 'CreateGeometricClip'
});

export function serializeCompositionGraph(compositor) {
  const objects = [];
  for (const object of compositor.objects.values()) {
    if (!factories[object.kind] && object.kind !== 'CompositionEffectBrush') continue;
    const row = {id: object.id, kind: object.kind, values: encodeCompositionValue(object.baseValues ?? {}),
      properties: object.Properties?.id ?? null, children: object.Children ? [...object.Children].map(value => value.id) : null,
      shapes: object.Shapes ? [...object.Shapes].map(value => value.id) : null,
      stops: object.ColorStops ? [...object.ColorStops].map(value => value.id) : null};
    if (object.kind === 'CompositionPropertySet') row.entries = [...object.values].map(([name, entry]) => [name, entry.kind, encodeCompositionValue(object.baseValues[name])]);
    if (object.StrokeDashArray) row.dashes = [...object.StrokeDashArray];
    if (object.graph) row.graph = encodeCompositionValue(object.graph);
    if (object.sources) row.sources = [...object.sources].map(([name, value]) => [name, value.id]);
    objects.push(row);
  }
  return {objects, roots: [...compositor.roots].map(visual => visual.id)};
}

function validateGraph(graph) {
  if (!graph || !Array.isArray(graph.objects) || graph.objects.length > 10000 || !Array.isArray(graph.roots)
    || graph.roots.length > 10000 || new Set(graph.roots).size !== graph.roots.length) throw new TypeError('Invalid composition graph');
  const rows = new Map();
  for (const row of graph.objects) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || rows.has(row.id) || (!factories[row.kind] && row.kind !== 'CompositionEffectBrush')) {
      throw new TypeError('Invalid composition graph node identity or kind');
    }
    rows.set(row.id, row);
  }
  validateGraphReferences(rows, graph.roots);
  return rows;
}

/** Apply a validated graph to host-owned native models; placement changes preserve content packets. */
export function applyCompositionGraph(compositor, graph, objects = new Map()) {
  graph = encodeCompositionValue(graph);
  const rows = validateGraph(graph);
  const candidates = new Map(objects);
  const created = [];
  let changes;
  try {
    const ordered = [...rows].sort((left, right) => Number(left[1].kind === 'CompositionPropertySet') - Number(right[1].kind === 'CompositionPropertySet'));
    for (const [id, row] of ordered) {
      const current = candidates.get(id);
      if (current && current.kind !== row.kind) throw new TypeError('Transported composition identity cannot change its kind');
      if (current?.kind === row.kind && !current.closed) continue;
      const value = row.kind === 'CompositionEffectBrush'
        ? new CompositionEffectBrush(compositor, row.graph) : compositor[factories[row.kind]]();
      created.push(value);
      candidates.set(id, value);
      if (value.Properties && value.Properties !== value && row.properties && !candidates.has(row.properties)) {
        candidates.set(row.properties, value.Properties);
      }
    }
    changes = prepareGraphChanges(rows, candidates, decodeCompositionValue);
  } catch (error) {
    for (const object of created) object.dispose();
    throw error;
  }
  for (const [id, object] of objects) {
    if (!rows.has(id) || candidates.get(id) !== object) object.dispose();
    if (!rows.has(id)) candidates.delete(id);
  }
  commitGraphChanges(changes, candidates);
  compositor.roots = new Set(graph.roots.map(id => candidates.get(id)));
  compositor.invalidate();
  return candidates;
}
