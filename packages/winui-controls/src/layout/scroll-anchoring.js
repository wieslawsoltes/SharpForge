import { clamp } from './geometry.js';

function relativePoint(context, candidate) {
  let current = context.state(candidate), x = 0, y = 0, depth = 0;
  while (current && current.id !== context.id) {
    if (++depth > 512) throw new RangeError('SFUI1673: Scroll anchor ancestry limit');
    x += current.rect.x;
    y += current.rect.y;
    current = context.state(current.parent);
  }
  return current ? { x, y } : null;
}

/** Explicit candidates retain their position across content mutations without an IScrollInfo interface. */
export function anchorScroll(context, scroll) {
  const previous = context.data.anchor;
  const candidates = new Set(context.data.anchorCandidates ?? []);
  const pending = [...context.children];
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > 20000) throw new RangeError('SFUI1603: Scroll anchor subtree limit');
    const state = context.state(pending[index]);
    if (!state) continue;
    if (state.node.properties.CanBeScrollAnchor) candidates.add(state.id);
    pending.push(...state.children);
  }
  if (candidates.size > 2048) throw new RangeError('SFUI1673: Scroll anchor candidate limit');
  if (previous && candidates.has(previous.id)) {
    const point = relativePoint(context, previous.id);
    if (point && previous.horizontalOffset === scroll.horizontalOffset && previous.verticalOffset === scroll.verticalOffset) {
      scroll.horizontalOffset = clamp(scroll.horizontalOffset + point.x - previous.point.x,
        0, Math.max(0, scroll.extent.width - scroll.viewport.width / scroll.zoomFactor));
      scroll.verticalOffset = clamp(scroll.verticalOffset + point.y - previous.point.y,
        0, Math.max(0, scroll.extent.height - scroll.viewport.height / scroll.zoomFactor));
    }
  }
  const target = { x: scroll.horizontalOffset + (context.properties.HorizontalAnchorRatio ?? 0) * scroll.viewport.width / scroll.zoomFactor,
    y: scroll.verticalOffset + (context.properties.VerticalAnchorRatio ?? 0) * scroll.viewport.height / scroll.zoomFactor };
  let selected = null, distance = Infinity;
  for (const id of candidates) {
    const point = relativePoint(context, id);
    if (!point) continue;
    const value = (point.x - target.x) ** 2 + (point.y - target.y) ** 2;
    if (value < distance) { distance = value; selected = { id, point }; }
  }
  context.data.anchor = selected ? { ...selected, horizontalOffset: scroll.horizontalOffset, verticalOffset: scroll.verticalOffset } : null;
  context.data.currentAnchor = selected?.id ?? null;
}

export function registerScrollAnchor(host, id, candidate, remove = false) {
  const state = host.layoutEngine.states.get(id);
  if (!state || !host.nodes.has(candidate)) throw new Error('SFUI1673: Unknown scroll anchor element');
  if (!relativePoint(host.layoutEngine.context(state), candidate) || candidate === id) {
    throw new Error('SFUI1673: Scroll anchor must be a descendant of the scrolling content');
  }
  state.data.anchorCandidates ??= new Set();
  if (remove) state.data.anchorCandidates.delete(candidate);
  else {
    if (state.data.anchorCandidates.size >= 2048) throw new RangeError('SFUI1673: Scroll anchor candidate limit');
    state.data.anchorCandidates.add(candidate);
  }
  host.invalidate(id, 'arrange');
}
