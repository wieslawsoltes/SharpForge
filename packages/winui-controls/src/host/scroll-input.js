import { getScrollModel } from '../layout/scroll-host.js';
import { inverseMatrix, transformPoint } from '../layout/render-properties.js';

function localPoint(context, node, event) {
  const inverse = inverseMatrix(context.host.getLayout(node.id)?.worldTransform ?? [1, 0, 0, 1, 0, 0]);
  return inverse ? transformPoint(inverse, context.host.input.position(event)) : { x: 0, y: 0 };
}
function touchState(context, node) {
  const state = context.getState(node);
  return state.scrollTouch ??= { pointers: new Map(), active: false, baseline: null };
}
function gesture(points) {
  const [first, second] = points;
  return second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, distance: Math.hypot(first.x - second.x, first.y - second.y) }
    : { ...first, distance: 0 };
}
function baseline(state, model) {
  state.baseline = { ...gesture([...state.pointers.values()]), horizontal: model.horizontalOffset,
    vertical: model.verticalOffset, zoom: model.zoomFactor };
}

function wheel(context, node, element, event) {
  if (event.defaultPrevented) return;
  const model = getScrollModel(context.host, node.id);
  const unit = event.deltaMode === 1 ? Number.parseFloat(context.document.defaultView.getComputedStyle(element).fontSize) || 16
    : event.deltaMode === 2 ? model.viewportHeight : 1;
  const point = localPoint(context, node, event);
  let changed;
  if (event.ctrlKey) {
    if (![1, 'Enabled'].includes(node.properties.ZoomMode)) return;
    const zoom = Math.max(model.minimumZoomFactor, Math.min(model.maximumZoomFactor, model.zoomFactor * Math.exp(-event.deltaY * unit * 0.002)));
    changed = model.interact(model.horizontalOffset + point.x / model.zoomFactor - point.x / zoom,
      model.verticalOffset + point.y / model.zoomFactor - point.y / zoom, zoom);
  } else changed = model.interact(model.horizontalOffset + event.deltaX * unit / model.zoomFactor,
    model.verticalOffset + event.deltaY * unit / model.zoomFactor, null);
  if (changed) event.preventDefault();
}

function pointerDown(context, node, element, event) {
  if (event.pointerType !== 'touch' || event.target.closest?.('[data-scroll-axis]')) return;
  const state = touchState(context, node);
  if (state.pointers.size >= 16) throw new RangeError('SFUI1673: Scroll pointer limit');
  state.pointers.set(event.pointerId, localPoint(context, node, event));
  if (state.active) {
    context.host.input.gestures.cancel(event.pointerId);
    context.host.input.capture.capture(node.id, event.pointerId);
  }
  baseline(state, getScrollModel(context.host, node.id));
}
function pointerMove(context, node, element, event) {
  const state = touchState(context, node);
  if (!state.pointers.has(event.pointerId) || event.defaultPrevented) return;
  state.pointers.set(event.pointerId, localPoint(context, node, event));
  const model = getScrollModel(context.host, node.id), start = state.baseline;
  const current = gesture([...state.pointers.values()]);
  const pinch = state.pointers.size >= 2 && [1, 'Enabled'].includes(node.properties.ZoomMode) && start.distance > 0;
  if (!state.active && Math.hypot(current.x - start.x, current.y - start.y) < 4
    && (!pinch || Math.abs(current.distance - start.distance) < 4)) return;
  const zoom = pinch ? Math.max(model.minimumZoomFactor, Math.min(model.maximumZoomFactor, start.zoom * current.distance / start.distance)) : start.zoom;
  const changed = model.interact(start.horizontal + start.x / start.zoom - current.x / zoom,
    start.vertical + start.y / start.zoom - current.y / zoom, zoom, true);
  if (!changed && !state.active) return;
  if (!state.active) {
    state.active = true;
    for (const id of state.pointers.keys()) {
      context.host.input.gestures.cancel(id);
      context.host.input.capture.capture(node.id, id);
    }
  }
  event.preventDefault();
}
function pointerEnd(context, node, element, event) {
  const state = touchState(context, node);
  if (!state.pointers.delete(event.pointerId)) return;
  const model = getScrollModel(context.host, node.id);
  if (state.active) {
    model.interact(null, null, null, state.pointers.size > 0);
    event.preventDefault();
  }
  if (state.pointers.size) baseline(state, model);
  else { state.active = false; state.baseline = null; }
}

function keyDown(context, node, element, event) {
  if (event.defaultPrevented || event.target !== element) return;
  const model = getScrollModel(context.host, node.id);
  const step = 32 / model.zoomFactor, page = model.viewportHeight / model.zoomFactor;
  const values = { ArrowDown: [0, step], ArrowUp: [0, -step], ArrowRight: [step, 0], ArrowLeft: [-step, 0],
    PageDown: [0, page], PageUp: [0, -page], Home: [-model.horizontalOffset, -model.verticalOffset],
    End: [0, model.scrollableHeight - model.verticalOffset] }[event.key];
  if (values && model.interact(model.horizontalOffset + values[0], model.verticalOffset + values[1], null)) event.preventDefault();
}

export const scrollInputEvents = { wheel, pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd,
  pointercancel: pointerEnd, keydown: keyDown };
