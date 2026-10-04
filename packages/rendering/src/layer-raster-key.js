import {DrawOp, DrawingError} from './drawing/commands.js';
import {shadowBounds} from './brushes/shadows.js';

export function resourceIdentity(handle) {
  return typeof handle?.session === 'string' && Number.isSafeInteger(handle.id)
    ? handle.session + ':' + handle.id + ':' + handle.generation : handle;
}

export function layerResources(list, table) {
  const handles = new Map();
  const visited = new Set();
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || visited.has(value)) return;
    if (depth > 64) throw new DrawingError('SFRENDER130', 'Layer resource nesting budget exceeded');
    visited.add(value);
    if (value.session && Number.isSafeInteger(value.id)) {
      handles.set(resourceIdentity(value), value);
      visit(table.resolve(value), depth + 1);
    } else for (const child of Object.values(value)) visit(child, depth + 1);
  };
  visit(list.commands, 0);
  return [...handles.values()];
}

function effectOutset(node, depth = 0) {
  if (!node || depth > 16) return 0;
  return (node.type === 'GaussianBlur' ? Math.ceil((node.blurAmount ?? 0) * 3) : 0)
    + Math.max(0, ...(node.sources ?? []).map(source => effectOutset(source, depth + 1)));
}

/** A raster key depends on local content, resources and scale; moving the layer does not invalidate it. */
export function describeLayerRaster(layer, resources, options) {
  const original = layer.bounds ?? layer.displayList.bounds ?? [0, 0, options.width, options.height];
  const outset = effectOutset(layer.effect);
  const bounds = shadowBounds([original[0] - outset, original[1] - outset, original[2] + outset * 2, original[3] + outset * 2], layer.shadow);
  if (bounds.some(value => !Number.isFinite(value)) || bounds[2] <= 0 || bounds[3] <= 0) return null;
  const width = Math.max(1, Math.ceil(bounds[2] * options.dpr));
  const height = Math.max(1, Math.ceil(bounds[3] * options.dpr));
  if (width * height > 16777216 || width > 16384 || height > 16384) throw new DrawingError('SFRENDER131', 'Cached layer pixel budget exceeded');
  const handles = layerResources({commands: [layer.displayList.commands, layer.shadow?.mask]}, resources);
  const revision = handles.map(handle => [resourceIdentity(handle), resources.getVersion(handle)]);
  const content = layer.cacheKey ?? layer.displayList.elementId;
  const key = content ? `${resources?.session ?? 'plain'}:${content}` : layer.displayList;
  const version = JSON.stringify([layer.contentVersion ?? layer.displayList.version, bounds, options.dpr, revision,
    layer.effect ?? null, layer.shadow ?? null, options.blendColorSpace ?? 'srgb', options.textVersion ?? 0]);
  const list = {commands: [{op: DrawOp.PushTransform, transform: [1, 0, 0, 1, -bounds[0], -bounds[1]]},
    ...layer.displayList.commands, {op: DrawOp.Pop}]};
  return {key, version, bounds, width, height, handles, list, contentBounds: original};
}

export function hasBackdropDependency(value, resources, seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || seen.has(value) || ArrayBuffer.isView(value)) return false;
  if (depth > 64) throw new DrawingError('SFRENDER130', 'Layer resource nesting budget exceeded');
  seen.add(value);
  if (['backdrop', 'acrylic'].includes(value.kind)) return true;
  if (value.session && Number.isSafeInteger(value.id)) return hasBackdropDependency(resources.resolve(value), resources, seen, depth + 1);
  return Object.values(value).some(child => hasBackdropDependency(child, resources, seen, depth + 1));
}
