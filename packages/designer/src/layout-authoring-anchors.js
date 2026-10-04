import {normalizeProperty, resolvedProperties} from './model.js';
import {designRectangle, geometryInvariant} from './geometry-coordinates.js';

const dimensions = {left: ['HorizontalAlignment', 'Width'], right: ['HorizontalAlignment', 'Width'],
  top: ['VerticalAlignment', 'Height'], bottom: ['VerticalAlignment', 'Height']};

/** Anchor metadata is inferred from WinUI alignment and effective margin values. */
export function designAnchors(properties) {
  const horizontal = properties.HorizontalAlignment ?? 3;
  const vertical = properties.VerticalAlignment ?? 3;
  return {left: horizontal === 0 || horizontal === 3, right: horizontal === 2 || horizontal === 3,
    top: vertical === 0 || vertical === 3, bottom: vertical === 2 || vertical === 3};
}

/** Toggling an anchor retains current bounds and clears explicit size only when stretching. */
export function toggleDesignAnchor(document, {id = document.selection[0], side, bounds, parentBounds}) {
  geometryInvariant(Object.hasOwn(dimensions, side), 'SFD_ANCHOR_SIDE', 'Unknown margin anchor.');
  const node = document.node(id);
  geometryInvariant(node && document.parent(id) && !document.parent(id).type.endsWith('.Canvas'),
    'SFD_ANCHOR_PARENT', 'Margin anchors require a layout panel, not a Canvas.');
  const rectangle = designRectangle(bounds);
  const parent = designRectangle(parentBounds);
  const properties = resolvedProperties(document.value, node).properties;
  const anchors = designAnchors(properties);
  anchors[side] = !anchors[side];
  const [alignment, size] = dimensions[side];
  const leading = size === 'Width' ? anchors.left : anchors.top;
  const trailing = size === 'Width' ? anchors.right : anchors.bottom;
  const value = leading && trailing ? 3 : leading ? 0 : trailing ? 2 : 1;
  const margins = {Left: rectangle.Left, Top: rectangle.Top,
    Right: parent.Width - rectangle.Left - rectangle.Width, Bottom: parent.Height - rectangle.Top - rectangle.Height};
  return document.change(`Toggle ${side} anchor`, candidate => {
    const target = candidate.nodes.find(item => item.id === id);
    target.properties[alignment] = value;
    target.properties.Margin = normalizeProperty(target.type, 'Margin', margins);
    if (value === 3) delete target.properties[size];
    else target.properties[size] = rectangle[size];
  });
}

export function setDesignMargin(document, {id = document.selection[0], side, value, expectedRevision = document.revision}) {
  geometryInvariant(Object.hasOwn(dimensions, side) && Number.isFinite(value), 'SFD_ANCHOR_MARGIN', 'Margin must be finite.');
  const node = document.node(id);
  const effective = resolvedProperties(document.value, node).properties.Margin ?? {};
  const margins = Object.fromEntries(['Left', 'Top', 'Right', 'Bottom'].map(key => [key, effective[key] ?? 0]));
  margins[side[0].toUpperCase() + side.slice(1)] = value;
  return document.change(`Set ${side} margin`, candidate => {
    const target = candidate.nodes.find(item => item.id === id);
    target.properties.Margin = normalizeProperty(target.type, 'Margin', margins);
  }, {expectedRevision});
}
