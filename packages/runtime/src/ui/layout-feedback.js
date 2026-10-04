import { ManagedFault } from '../heap.js';
import { layoutReference } from './layout-scene.js';

const limit = 1e9;
function coordinate(value, name, positive = false) {
  if (!Number.isFinite(value) || Math.abs(value) > limit || positive && value < 0) {
    throw new ManagedFault('ArgumentException', 'Invalid layout feedback ' + name);
  }
  return value;
}
function dimensions(value) {
  return { width: coordinate(value?.width, 'width', true), height: coordinate(value?.height, 'height', true) };
}
function bounds(value) {
  return { x: coordinate(value?.x, 'x'), y: coordinate(value?.y, 'y'), ...dimensions(value) };
}
function matrix(value) {
  if (!Array.isArray(value) || value.length !== 6) throw new ManagedFault('ArgumentException', 'Invalid layout transform');
  return value.map(item => coordinate(item, 'transform'));
}
function scroll(value, context) {
  if (value == null) return null;
  const zoomFactor = coordinate(value.zoomFactor, 'zoomFactor', true);
  if (zoomFactor === 0) throw new ManagedFault('ArgumentException', 'Invalid scroll zoom feedback');
  return { extent: dimensions(value.extent), viewport: dimensions(value.viewport), zoomFactor,
    horizontalOffset: coordinate(value.horizontalOffset, 'horizontalOffset', true),
    verticalOffset: coordinate(value.verticalOffset, 'verticalOffset', true),
    currentAnchor: value.currentAnchor == null ? null : context.id(layoutReference(context, value.currentAnchor)) };
}

/** Browser geometry is a bounded data-only cache; measurements remain synchronous in the VM. */
export function readLayoutFeedback(context, snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.nodes) || snapshot.nodes.length > 20000) {
    throw new ManagedFault('ArgumentException', 'Invalid layout feedback snapshot');
  }
  const result = new Map();
  for (const item of snapshot.nodes) {
    const id = context.id(layoutReference(context, item.id));
    if (result.has(id)) throw new ManagedFault('ArgumentException', 'Duplicate layout feedback identity');
    const parentId = item.parentId == null ? null : context.id(layoutReference(context, item.parentId));
    if (item.clips?.length > 512 || !Array.isArray(item.children) || item.children.length > 20000) {
      throw new ManagedFault('ArgumentException', 'Layout feedback tree limit');
    }
    result.set(id, { id, parentId, rect: bounds(item.rect), slot: bounds(item.slot), bounds: bounds(item.bounds),
      renderSize: dimensions(item.renderSize), desiredSize: dimensions(item.desiredSize),
      localTransform: matrix(item.localTransform), worldTransform: matrix(item.worldTransform),
      clip: item.clip == null ? null : bounds(item.clip),
      scroll: scroll(item.scroll, context),
      clips: (item.clips ?? []).map(clip => ({ rect: bounds(clip.rect), transform: matrix(clip.transform) })),
      children: item.children.map(child => context.id(layoutReference(context, child))), version: item.version ?? 0 });
  }
  return result;
}

export function scrollMetrics(state) {
  const scroll = state?.data.scroll;
  if (!scroll) return null;
  const { extent, viewport, horizontalOffset, verticalOffset, zoomFactor } = scroll;
  return { ExtentWidth: extent.width, ExtentHeight: extent.height, ViewportWidth: viewport.width, ViewportHeight: viewport.height,
    HorizontalOffset: horizontalOffset, VerticalOffset: verticalOffset, ZoomFactor: zoomFactor,
    ScrollableWidth: Math.max(0, extent.width - viewport.width / zoomFactor),
    ScrollableHeight: Math.max(0, extent.height - viewport.height / zoomFactor) };
}
