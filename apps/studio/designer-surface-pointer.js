function createHitLayer(overlay) {
  const layer = overlay.ownerDocument.createElement('div');
  layer.dataset.designGestureCapture = '';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {position: 'absolute', inset: '0', zIndex: '20', pointerEvents: 'none', cursor: 'default'});
  overlay.append(layer);
  return layer;
}

/** Mount one inert capture surface with the view, avoiding DOM insertion and removal at pointer boundaries. */
export function prepareDesignerPointer(controller) {
  const overlay = controller.view.overlay;
  if (!overlay) return null;
  if (controller.pointerLayer?.parentElement === overlay) return controller.pointerLayer;
  controller.cancelPointer?.();
  controller.pointerLayer?.remove();
  controller.pointerLayer = createHitLayer(overlay);
  return controller.pointerLayer;
}

/** Cancel the active pointer before releasing its view-owned capture surface. */
export function disposeDesignerPointer(controller) {
  try { controller.cancelPointer?.(); }
  finally {
    controller.pointerLayer?.remove();
    controller.pointerLayer = null;
  }
}

/** Capture the original hit target to retain click/double-click ownership while a cheap layer handles hover hit tests. */
function capturePointer(controller, start, cancel) {
  const view = controller.view;
  const owner = typeof start.target?.setPointerCapture === 'function' ? start.target : view.stage;
  const supported = ['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'].every(name => typeof owner[name] === 'function');
  const retained = controller.pointerLayer?.parentElement === view.overlay;
  let layer = null;
  let disposed = false;
  const lost = event => { if (event.pointerId === start.pointerId) cancel(); };
  const release = () => {
    if (disposed) return;
    disposed = true;
    owner.removeEventListener?.('lostpointercapture', lost);
    if (layer) {
      if (retained) layer.style.pointerEvents = 'none';
      else layer.remove();
    }
    if (supported && owner.hasPointerCapture(start.pointerId)) owner.releasePointerCapture(start.pointerId);
  };
  try {
    if (supported) {
      owner.addEventListener('lostpointercapture', lost);
      owner.setPointerCapture(start.pointerId);
    }
    if (supported && view.overlay) {
      const document = view.overlay.ownerDocument;
      const cursor = document.defaultView.getComputedStyle?.(owner).cursor ?? 'default';
      layer = retained ? controller.pointerLayer : createHitLayer(view.overlay);
      layer.style.cursor = cursor;
      layer.style.pointerEvents = 'auto';
    }
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

/** One pointer owns the gesture. Every termination releases capture, its hit layer, listeners and pending frames. */
export function trackDesignerPointer(controller, start, move, done, cancel) {
  controller.cancelPointer?.();
  const document = controller.view.stage.ownerDocument;
  const window = document.defaultView;
  let active = true;
  let latest = null;
  let frame = null;
  let moved = false;
  let release = null;
  const flush = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (!active || !latest) return;
    const event = latest;
    latest = null;
    try { move(event); } catch (error) { abort(); controller.view.error(error); }
  };
  const cleanup = () => {
    active = false;
    if (frame !== null) window.cancelAnimationFrame(frame);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    controller.cancelPointer = null;
    release?.();
  };
  const abort = () => {
    if (!active) return;
    cleanup();
    controller.view.safe(cancel);
  };
  const onMove = event => {
    if (!active || event.pointerId !== start.pointerId) return;
    moved = true;
    latest = event;
    if (frame === null) frame = window.requestAnimationFrame(flush);
  };
  const onUp = event => {
    if (!active || event.pointerId !== start.pointerId) return;
    if (moved) latest = event;
    if (latest) flush();
    if (!active) return;
    cleanup();
    controller.view.safe(() => done(event));
  };
  const onCancel = event => { if (event.pointerId === start.pointerId) abort(); };
  const onKey = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    abort();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  controller.cancelPointer = abort;
  try { release = capturePointer(controller, start, abort); }
  catch (error) { abort(); throw error; }
  if (!active) release();
  return abort;
}
