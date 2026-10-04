/** Each pointer has one owner; unload, cancellation and disposal publish capture loss exactly once. */
export class PointerCaptureManager {
  constructor({ elementFor = () => null, onLost = () => {} } = {}) {
    this.elementFor = elementFor;
    this.onLost = onLost;
    this.captures = new Map();
    this.disposed = false;
  }
  capture(id, pointerId) {
    if (this.disposed || !Number.isInteger(pointerId) || pointerId < 0) return false;
    const element = this.elementFor(id);
    if (!element) return false;
    const previous = this.captures.get(pointerId);
    if (previous === id) return true;
    if (previous) this.release(previous, pointerId, 'Transferred');
    try { element.setPointerCapture?.(pointerId); }
    catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
    this.captures.set(pointerId, id);
    return true;
  }
  owner(pointerId) { return this.captures.get(pointerId) ?? null; }
  release(id, pointerId, reason = 'Released') {
    if (this.captures.get(pointerId) !== id) return false;
    this.captures.delete(pointerId);
    const element = this.elementFor(id);
    if (element?.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    this.onLost(id, { Pointer: { PointerId: pointerId }, Reason: reason });
    return true;
  }
  releaseAll(id, reason = 'Unloaded') {
    for (const [pointerId, owner] of [...this.captures]) if (owner === id) this.release(id, pointerId, reason);
  }
  lost(pointerId) {
    const owner = this.owner(pointerId);
    if (owner !== null) this.release(owner, pointerId, 'NativeCaptureLost');
  }
  dispose() {
    for (const [pointerId, id] of [...this.captures]) this.release(id, pointerId, 'Disposed');
    this.disposed = true;
  }
}
