import {rect, LayoutError} from './geometry.js';
import {inverseMatrix, multiplyMatrix, transformBounds} from './render-properties.js';

const coordinateLimit = 1e9;
const emptyViewport = () => rect();

function checkedRect(value) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]) && Math.abs(value[key]) <= coordinateLimit)
    || value.width < 0 || value.height < 0) throw new LayoutError('SFUI1678', 'Invalid effective viewport geometry');
  return value;
}

function intersect(left, right) {
  const x = Math.max(left.x, right.x), y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;
  return width <= 0 || height <= 0 ? emptyViewport() : checkedRect(rect(x, y, width, height));
}

function maximumAxis(start, length, nextStart, nextLength) {
  const maximumLength = Math.min(length, nextLength);
  return [Math.max(nextStart, Math.min(start, nextStart + nextLength - maximumLength)), maximumLength];
}

function maximumViewport(ports) {
  let maximum = {...ports[0]};
  for (let index = 1; index < ports.length; index++) {
    const port = ports[index];
    const [x, width] = maximumAxis(maximum.x, maximum.width, port.x, port.width);
    const [y, height] = maximumAxis(maximum.y, maximum.height, port.y, port.height);
    maximum = rect(x, y, width, height);
  }
  return maximum;
}

function bringDistance(start, length, ports, axis, dimension) {
  let distance = 0;
  for (let index = ports.length - 1; index >= 0; index--) {
    const port = ports[index], before = port[axis] - start, after = port[axis] + port[dimension] - start - length;
    length = Math.min(length, port[dimension]);
    if (before <= 0 && after >= 0) continue;
    if (before > 0 && after < 0) start = port[axis];
    else if (Math.abs(before) <= Math.abs(after)) { distance += Math.abs(before); start = port[axis]; }
    else { distance += Math.abs(after); start = port[axis] + port[dimension] - length; }
  }
  if (!Number.isFinite(distance) || distance > coordinateLimit) throw new LayoutError('SFUI1678', 'Bring-into-view distance limit');
  return distance;
}

function affine(value) {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(item => Number.isFinite(item) && Math.abs(item) <= coordinateLimit)) {
    throw new LayoutError('SFUI1678', 'Invalid effective viewport transform');
  }
  return value;
}

function transformed(matrix, bounds) {
  try { return checkedRect(transformBounds(matrix, bounds)); }
  catch (error) {
    if (error instanceof LayoutError) throw new LayoutError('SFUI1678', 'Effective viewport transform exceeded its coordinate budget');
    throw error;
  }
}

function relativeTransform(entry, chain) {
  if (!chain.length) return entry.worldTransform;
  const inverse = inverseMatrix(chain.at(-1).worldTransform);
  return inverse && multiplyMatrix(inverse, entry.worldTransform);
}

function toGlobal(entry, chain, bounds) {
  const relative = relativeTransform(entry, chain);
  if (!relative) return emptyViewport();
  let result = transformed(relative, bounds);
  for (let index = chain.length - 1; index >= 0; index--) result = transformed(chain[index].relative, result);
  return result;
}

function toLocal(entry, chain, bounds) {
  let result = bounds;
  for (const port of chain) {
    const inverse = inverseMatrix(port.relative);
    if (!inverse) return emptyViewport();
    result = transformed(inverse, result);
  }
  const relative = relativeTransform(entry, chain), inverse = relative && inverseMatrix(relative);
  return inverse ? transformed(inverse, result) : emptyViewport();
}

function scrollPort(entry, node) {
  if (!entry.scroll || !(entry.scrollPortClip ?? entry.clip)) return false;
  if (typeof entry.isScrollPort === 'boolean') return entry.isScrollPort;
  // ScrollView's template presenter owns the viewport; the outer control only forwards its metrics.
  return !((node?.frameworkType ?? node?.type)?.split('.').at(-1) === 'ScrollView' && node.templateRoot);
}

function viewportPayload(entry, chain) {
  const ports = chain.map(port => port.bounds);
  const inverse = inverseMatrix(entry.worldTransform);
  if (!inverse) return {EffectiveViewport: emptyViewport(), MaxViewport: emptyViewport(), BringIntoViewDistanceX: 0, BringIntoViewDistanceY: 0};
  let effective = ports[0];
  for (let index = 1; index < ports.length; index++) effective = intersect(effective, ports[index]);
  const ownBounds = toGlobal(entry, chain, rect(0, 0, entry.renderSize.width, entry.renderSize.height));
  return {
    EffectiveViewport: effective.width && effective.height ? toLocal(entry, chain, effective) : emptyViewport(),
    MaxViewport: toLocal(entry, chain, maximumViewport(ports)),
    BringIntoViewDistanceX: bringDistance(ownBounds.x, ownBounds.width, ports, 'x', 'width'),
    BringIntoViewDistanceY: bringDistance(ownBounds.y, ownBounds.height, ports, 'y', 'height')
  };
}

/**
 * Derive parent-first viewport payloads in element-local DIPs from a completed world-layout map.
 * Only registered built-in scroll-port clips restrict viewports. Ordinary clips and element bounds do not.
 * Affine rectangles use their axis-aligned bounds, matching the Rect-valued contract. Work is O(nodes * scroll depth),
 * bounded by maximumNodes/maximumDepth. Empty or singular viewports use a finite zero-area Rect for transport.
 */
export function computeEffectiveViewports(layouts, {resolveNode = id => layouts.get(id)?.node,
  maximumNodes = 20000, maximumDepth = 512} = {}) {
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 0 || maximumNodes > 20000
    || !Number.isSafeInteger(maximumDepth) || maximumDepth < 0 || maximumDepth > 512) {
    throw new LayoutError('SFUI1678', 'Invalid effective viewport traversal budget');
  }
  if (!(layouts instanceof Map) || layouts.size > maximumNodes) throw new LayoutError('SFUI1678', 'Effective viewport node limit');
  const states = new Map(), active = new Set(), result = new Map();
  const visit = (id, depth) => {
    if (states.has(id)) return states.get(id);
    if (depth > maximumDepth || active.has(id)) throw new LayoutError('SFUI1678', 'Effective viewport ancestry cycle or depth limit');
    const entry = layouts.get(id);
    if (!entry) throw new LayoutError('SFUI1678', 'Effective viewport parent is absent');
    active.add(id);
    const parent = entry.parentId == null ? null : visit(entry.parentId, depth + 1);
    const ancestryDepth = (parent?.depth ?? -1) + 1;
    if (ancestryDepth > maximumDepth) throw new LayoutError('SFUI1678', 'Effective viewport ancestry depth limit');
    const node = resolveNode(id), properties = node?.properties ?? {};
    affine(entry.worldTransform);
    const local = checkedRect({x: 0, y: 0, width: entry.renderSize?.width, height: entry.renderSize?.height});
    const visible = parent?.visible !== false && entry.participatesInLayout !== false
      && properties.Visibility !== 1 && properties.Visibility !== 'Collapsed' && properties.Visible !== false;
    let ports = parent?.ports ?? [{bounds: transformed(entry.worldTransform, local),
      worldTransform: entry.worldTransform, relative: entry.worldTransform}];
    // A registered port affects its descendants, not its own EffectiveViewportChanged payload.
    if (visible) result.set(id, viewportPayload(entry, ports));
    if (scrollPort(entry, node)) {
      const relative = relativeTransform(entry, ports);
      if (relative) ports = [...ports, {bounds: toGlobal(entry, ports, intersect(local, checkedRect(entry.scrollPortClip ?? entry.clip))),
        worldTransform: entry.worldTransform, relative}];
    }
    const state = {visible, ports, depth: ancestryDepth};
    states.set(id, state);
    active.delete(id);
    return state;
  };
  for (const id of layouts.keys()) visit(id, 0);
  return result;
}
