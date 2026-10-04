import { FocusManager, RoutedEventRouter } from '@sharpforge/winui-controls';
import { ManagedFault } from '../heap.js';
import { layoutReference } from './layout-scene.js';

/** Managed focus and capture have logical identity even when the presentation host is in a worker. */
export class ManagedLayoutInput {
  constructor(service) {
    this.service = service;
    this.activePointers = new Set();
    this.captures = new Map();
    this.router = service.context.routedEventRouter ?? new RoutedEventRouter({
      parentOf: id => service.engine.states.get(id)?.parent,
      contains: id => service.nodes.has(id),
      onDispatch: (id, name, payload) => service.emit(id, name, payload)
    });
    this.ownsRouter = this.router !== service.context.routedEventRouter;
    this.focus = new FocusManager({ router: this.router, nodes: service.nodes,
      roots: () => service.engine.roots, childrenOf: id => service.engine.states.get(id)?.children ?? [],
      parentOf: id => service.engine.states.get(id)?.parent,
      layoutFor: id => service.getLayout(id), focusElement: (id, state) => {
        service.notify(id, 'Focus', [state]);
      }, onChanged: (previous, next, state) => {
        if (previous != null && previous !== next) service.setOutput(previous, 'FocusState', 0);
        if (next != null) service.setOutput(next, 'FocusState', state);
      } });
  }
  observePointer(payload, eventName) {
    const id = payload?.Pointer?.PointerId ?? payload?.CurrentPoint?.PointerId;
    if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new ManagedFault('ArgumentException', 'Invalid pointer identity');
    if (eventName === 'PointerPressed' || payload.Pointer?.IsInContact) this.activePointers.add(id);
    if (eventName === 'PointerReleased' || eventName === 'PointerCanceled') {
      this.activePointers.delete(id);
      const owner = this.captures.get(id);
      if (owner) this.release(owner, id);
    }
  }
  capture(id, pointerId) {
    if (!this.activePointers.has(pointerId) || !this.service.nodes.has(id)) return false;
    const previous = this.captures.get(pointerId);
    if (previous === id) return true;
    if (previous) this.release(previous, pointerId);
    this.captures.set(pointerId, id);
    this.service.notify(id, 'CapturePointer', [{ PointerId: pointerId }]);
    return true;
  }
  release(id, pointerId) {
    if (this.captures.get(pointerId) !== id) return false;
    this.captures.delete(pointerId);
    this.service.notify(id, 'ReleasePointerCapture', [{ PointerId: pointerId }]);
    this.router.raise(id, 'PointerCaptureLost', { Pointer: { PointerId: pointerId } });
    return true;
  }
  releaseAll(id) { for (const [pointer, owner] of [...this.captures]) if (owner === id) this.release(id, pointer); }
  snapshot() {
    return { focused: this.focus.focusedElement, focusState: this.focus.focusState,
      pointers: [...this.activePointers], captures: [...this.captures] };
  }
  restore(data) {
    this.focus.focusedElement = data.focused;
    this.focus.focusState = data.focusState;
    this.activePointers = new Set(data.pointers);
    this.captures = new Map(data.captures);
  }
  *retainedValues() {
    const ids = new Set([this.focus.focusedElement, ...this.captures.values()]);
    for (const id of ids) if (id) yield layoutReference(this.service.context, id);
  }
  dispose() {
    this.focus.dispose();
    this.captures.clear();
    this.activePointers.clear();
    if (this.ownsRouter) this.router.dispose();
  }
}
