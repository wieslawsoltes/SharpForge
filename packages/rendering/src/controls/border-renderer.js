import {localBounds} from './shape-renderer.js';
import {geometryToPath} from '../geometry/path-geometry.js';

const thickness = value => typeof value === 'number' ? [value, value, value, value] :
  [value?.Left ?? 0, value?.Top ?? 0, value?.Right ?? 0, value?.Bottom ?? 0];
const corners = value => typeof value === 'number' ? [value, value, value, value] :
  [value?.TopLeft ?? 0, value?.TopRight ?? 0, value?.BottomRight ?? 0, value?.BottomLeft ?? 0];

/** Non-uniform borders are an even-odd outer/inner ring, never a fill painted over a stroke. */
export function renderBorder(node, layout, context) {
  const p = node.properties, rect = localBounds(layout), radius = corners(p.CornerRadius);
  const [left, top, right, bottom] = thickness(p.BorderThickness);
  const inner = [left, top, Math.max(0, rect[2] - left - right), Math.max(0, rect[3] - top - bottom)];
  const innerRadii = [Math.max(0, radius[0] - left), Math.max(0, radius[0] - top),
    Math.max(0, radius[1] - right), Math.max(0, radius[1] - top), Math.max(0, radius[2] - right),
    Math.max(0, radius[2] - bottom), Math.max(0, radius[3] - left), Math.max(0, radius[3] - bottom)];
  if (p.Background) context.DrawRoundedRectangle(p.BackgroundSizing === 1 ? rect : inner,
    p.BackgroundSizing === 1 ? radius : innerRadii, p.Background);
  if (p.BorderBrush && left + top + right + bottom > 0) {
    const outerPath = geometryToPath({kind: 'rectangle', rect, radii: radius});
    const innerPath = geometryToPath({kind: 'rectangle', rect: inner, radii: innerRadii});
    context.DrawGeometry({kind: 'path', fillRule: 'evenodd', figures: [...outerPath.figures, ...innerPath.figures]}, p.BorderBrush);
  }
}

export function renderPanel(node, layout, context) {
  if (node.properties.Background) context.DrawRoundedRectangle(localBounds(layout), corners(node.properties.CornerRadius), node.properties.Background);
}

export function renderFocusVisual(node, layout, context) {
  const p = node.properties;
  if (!p.IsKeyboardFocused && p.FocusState !== 1) return;
  const rect = localBounds(layout), margin = thickness(p.FocusVisualMargin);
  const primary = thickness(p.FocusVisualPrimaryThickness ?? 2), secondary = thickness(p.FocusVisualSecondaryThickness ?? 1);
  const outer = [margin[0], margin[1], Math.max(0, rect[2] - margin[0] - margin[2]), Math.max(0, rect[3] - margin[1] - margin[3])];
  const ring = (bounds, edges, brush, radius) => {
    const inner = [bounds[0] + edges[0], bounds[1] + edges[1], Math.max(0, bounds[2] - edges[0] - edges[2]),
      Math.max(0, bounds[3] - edges[1] - edges[3])];
    const outside = geometryToPath({kind: 'rectangle', rect: bounds, radii: radius});
    const inside = geometryToPath({kind: 'rectangle', rect: inner, radii: Math.max(0, radius - Math.max(...edges))});
    context.DrawGeometry({kind: 'path', fillRule: 'evenodd', figures: [...outside.figures, ...inside.figures]}, brush);
    return inner;
  };
  const inner = ring(outer, primary, p.FocusVisualPrimaryBrush ?? '#ffffff', 2);
  ring(inner, secondary, p.FocusVisualSecondaryBrush ?? '#000000', 1);
}
