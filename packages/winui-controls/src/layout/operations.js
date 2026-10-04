import { getScrollModel, scrollModelMetrics } from './scroll-host.js';
import { registerScrollAnchor } from './scroll-anchoring.js';
import { getAnnotatedController } from './annotated-host.js';
import { findScrollPresenter } from './scroll-presenter.js';

const point = value => ({ x: value?.X ?? value?.x ?? 0, y: value?.Y ?? value?.y ?? 0 });
const size = value => ({ width: value?.Width ?? value?.width ?? 0, height: value?.Height ?? value?.height ?? 0 });
const directions = ['Next', 'Previous', 'Up', 'Down', 'Left', 'Right', 'None'];

/** Explicit operation table for the JS/managed host adapters; no runtime dispatcher patching. */
export function createLayoutOperations(host) {
  const callbacks = new Map();
  const add = (name, callback) => callbacks.set(name, callback);
  const viewport = id => findScrollPresenter(host.nodes.get(id), key => host.nodes.get(key)) ?? id;
  add('Measure', (id, [available]) => host.layoutEngine.measure(id, size(available)));
  add('Arrange', (id, [bounds]) => host.layoutEngine.arrange(id, { ...point(bounds), ...size(bounds) }));
  add('InvalidateMeasure', id => host.invalidate(id));
  add('InvalidateArrange', id => host.invalidate(id, 'arrange'));
  add('UpdateLayout', () => host.flush());
  add('Focus', (id, [state = 3]) => host.focusManager.focus(id, state));
  add('CapturePointer', (id, [pointer]) => host.input.capture.capture(id, pointer.PointerId ?? pointer.pointerId));
  add('ReleasePointerCapture', (id, [pointer]) => host.input.capture.release(id, pointer.PointerId ?? pointer.pointerId));
  add('ReleasePointerCaptures', id => host.input.capture.releaseAll(id));
  add('CompleteManipulation', id => host.input.manipulations.complete(id));
  add('GetFocusedElement', () => host.focusManager.focusedElement);
  add('TryMoveFocus', (id, [direction]) => host.focusManager.tryMoveFocus(directions[direction] ?? direction));
  add('FindNextElement', (id, [direction]) => host.focusManager.findNext(directions[direction] ?? direction));
  add('ChangeView', (id, args) => getScrollModel(host, id, false).changeView(...args));
  add('ScrollTo', (id, args) => getScrollModel(host, id, true).scrollTo(...args));
  add('ScrollBy', (id, args) => getScrollModel(host, id, true).scrollBy(...args));
  add('ZoomTo', (id, [zoom, center, options]) => getScrollModel(host, id, true).zoomTo(zoom, center == null ? null : point(center), options));
  add('RegisterAnchorCandidate', (id, [candidate]) => registerScrollAnchor(host, viewport(id), candidate));
  add('UnregisterAnchorCandidate', (id, [candidate]) => registerScrollAnchor(host, viewport(id), candidate, true));
  add('GetCurrentAnchor', id => host.layoutEngine.states.get(viewport(id))?.data.currentAnchor ?? null);
  add('GetScrollMetrics', id => scrollModelMetrics(getScrollModel(host, id)));
  add('CompleteControllerScroll', (id, [correlation]) => {
    if (!Number.isInteger(correlation) || correlation < 0 || correlation > 2147483647) throw new RangeError('SFUI1676: Invalid scroll completion');
    getAnnotatedController(host.context, host.nodes.get(id)).notifyRequestedScrollCompleted(correlation);
  });
  return {
    register(name, callback) {
      if (callbacks.has(name)) throw new Error('Layout operation already registered: ' + name);
      add(name, callback);
    },
    invoke(id, name, args = []) {
      const callback = callbacks.get(name);
      return callback ? { handled: true, value: callback(id, args) } : { handled: false };
    }
  };
}
