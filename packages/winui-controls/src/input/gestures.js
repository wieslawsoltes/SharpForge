import { pointerDeviceType } from './pointer-events.js';

/** Pointer-stream recognizer. Cancellation removes all pending tap and hold work. */
export class GestureRecognizer {
  constructor({ emit = () => {}, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
    movementThreshold = 8, holdDelay = 600, doubleTapDelay = 400 } = {}) {
    Object.assign(this, { emit, now, setTimer, clearTimer, movementThreshold, holdDelay, doubleTapDelay });
    this.active = new Map();
    this.lastTap = null;
    this.disposed = false;
  }
  down(id, pointer, properties = {}) {
    if (this.disposed) return;
    this.cancel(pointer.pointerId);
    const entry = { id, pointer: { ...pointer }, properties, moved: false, held: false, started: this.now(), timer: null };
    if (properties.IsHoldingEnabled !== false && pointer.pointerType !== 'mouse') {
      entry.timer = this.setTimer(() => {
        entry.timer = null;
        if (this.active.get(pointer.pointerId) !== entry || entry.moved) return;
        entry.held = true;
        this.emit(id, 'Holding', { Position: { X: pointer.x, Y: pointer.y }, PointerDeviceType: pointerDeviceType(pointer.pointerType), HoldingState: 0 });
      }, this.holdDelay);
    }
    this.active.set(pointer.pointerId, entry);
    if (this.active.size > 1) for (const value of this.active.values()) this.abortTap(value);
  }
  abortTap(entry) {
    entry.moved = true;
    if (entry.timer != null) this.clearTimer(entry.timer);
    entry.timer = null;
    if (entry.held) { this.emit(entry.id, 'Holding', { Position: { X: entry.pointer.x, Y: entry.pointer.y },
      PointerDeviceType: pointerDeviceType(entry.pointer.pointerType), HoldingState: 2 }); entry.held = false; }
  }
  move(pointer) {
    const entry = this.active.get(pointer.pointerId);
    if (entry && Math.hypot(pointer.x - entry.pointer.x, pointer.y - entry.pointer.y) > this.movementThreshold) this.abortTap(entry);
  }
  up(pointer) {
    const entry = this.active.get(pointer.pointerId);
    if (!entry) return;
    this.active.delete(pointer.pointerId);
    if (entry.timer != null) this.clearTimer(entry.timer);
    const payload = { Position: { X: pointer.x, Y: pointer.y }, PointerDeviceType: pointerDeviceType(pointer.pointerType) };
    if (entry.held) { this.emit(entry.id, 'Holding', { ...payload, HoldingState: 1 }); return; }
    if (entry.moved) return;
    if (pointer.button === 2) {
      if (entry.properties.IsRightTapEnabled !== false) this.emit(entry.id, 'RightTapped', payload);
      return;
    }
    const previous = this.lastTap;
    const timestamp = this.now();
    const double = previous && previous.id === entry.id && timestamp - previous.time <= this.doubleTapDelay
      && Math.hypot(previous.x - pointer.x, previous.y - pointer.y) <= this.movementThreshold;
    if (double && entry.properties.IsDoubleTapEnabled !== false) {
      this.emit(entry.id, 'DoubleTapped', { ...payload, TapCount: 2 });
      this.lastTap = null;
    } else {
      if (entry.properties.IsTapEnabled !== false) this.emit(entry.id, 'Tapped', { ...payload, TapCount: 1 });
      this.lastTap = { id: entry.id, x: pointer.x, y: pointer.y, time: timestamp };
    }
  }
  cancel(pointerId) {
    const entry = this.active.get(pointerId);
    if (!entry) return;
    this.abortTap(entry);
    this.active.delete(pointerId);
  }
  removeNode(id) {
    for (const [pointerId, entry] of this.active) if (entry.id === id) this.cancel(pointerId);
    if (this.lastTap?.id === id) this.lastTap = null;
  }
  dispose() { for (const pointerId of [...this.active.keys()]) this.cancel(pointerId); this.lastTap = null; this.disposed = true; }
}
