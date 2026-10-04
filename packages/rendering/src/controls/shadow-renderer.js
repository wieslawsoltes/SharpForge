import {DrawingContext} from '../drawing/context.js';
import {normalizeShadow, themeShadow} from '../brushes/shadows.js';

/** Theme shadows reuse the element's retained alpha; direct composition shadows retain their explicit mask. */
export function applyVisualShadow(list, node, {resolve = value => value, theme = 'light'} = {}) {
  if (!node.properties.Shadow) return list;
  const value = resolve(node.properties.Shadow);
  const type = (value?.type ?? value?.valueType ?? value?.kind ?? '').split('.').at(-1);
  const translation = node.properties.Translation ?? [0, 0, 0];
  const elevation = Math.max(0, translation.Z ?? translation[2] ?? node.properties.Elevation ?? 0);
  const shadow = type === 'ThemeShadow' ? themeShadow(elevation, {theme}) : normalizeShadow(value);
  if (!shadow?.opacity) return list;
  const drawing = new DrawingContext({elementId: list.elementId, version: list.version});
  drawing.DrawLayer({displayList: list, shadow, bounds: list.bounds, cacheKey: `shadow:${node.id}`, contentVersion: list.version});
  return drawing.finish(list.bounds);
}
