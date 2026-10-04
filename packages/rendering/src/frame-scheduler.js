export const FramePhase = Object.freeze(['input', 'layout', 'animation', 'build', 'submit', 'present']);

/** Coalesces application work into one frame request with explicit phase order. */
export class FrameScheduler {
  constructor({requestFrame, cancelFrame, now = () => performance.now(), onError = error => { throw error; }} = {}) {
    this.requestFrame = requestFrame ?? (callback => globalThis.requestAnimationFrame(callback));
    this.cancelFrame = cancelFrame ?? (id => globalThis.cancelAnimationFrame(id));
    this.now = now;
    this.onError = onError;
    this.callbacks = FramePhase.map(() => new Map());
    this.continuous = new Set();
    this.request = null;
    this.dirty = FramePhase.length;
    this.inputTime = null;
    this.previousTime = null;
    this.frame = 0;
    this.executing = false;
    this.executingPhase = -1;
    this.closed = false;
    this.paused = false;
    this.tick = time => {
      this.request = null;
      this.flush(time);
    };
  }

  phaseIndex(phase) {
    const index = FramePhase.indexOf(phase);
    if (index < 0) throw new TypeError(`Unknown frame phase: ${phase}`);
    return index;
  }

  register(phase, key, callback) {
    if (this.closed) throw new Error('Frame scheduler is disposed');
    const callbacks = this.callbacks[this.phaseIndex(phase)];
    if (callbacks.has(key)) throw new Error('Frame callback key is already registered');
    callbacks.set(key, callback);
    return () => callbacks.delete(key);
  }

  invalidate(phase = 'layout', inputTime) {
    if (this.closed) return;
    const index = this.phaseIndex(phase);
    if (!this.executing || index <= this.executingPhase) this.dirty = Math.min(this.dirty, index);
    if (inputTime !== undefined) {
      if (!Number.isFinite(inputTime)) throw new RangeError('Invalid input timestamp');
      this.inputTime = Math.min(this.inputTime ?? inputTime, inputTime);
    }
    this.schedule();
  }

  setContinuous(key, enabled) {
    if (enabled) this.continuous.add(key);
    else this.continuous.delete(key);
    if (enabled && !this.paused) this.invalidate('animation');
  }

  /** Debug pause freezes animation time while allowing current layout and paint inspection. */
  setPaused(paused) {
    if (typeof paused !== 'boolean') throw new TypeError('Scheduler pause state must be boolean');
    if (this.paused === paused || this.closed) return;
    this.paused = paused;
    this.previousTime = null;
    if (!paused && this.continuous.size) this.invalidate('animation');
  }

  schedule() {
    if (!this.closed && !this.executing && this.request === null && this.dirty < FramePhase.length) {
      this.request = this.requestFrame(this.tick);
    }
  }

  flush(time = this.now()) {
    if (this.closed || this.executing) return;
    if (!Number.isFinite(time)) throw new RangeError('Invalid frame timestamp');
    if (this.request !== null) this.cancelFrame(this.request);
    this.request = null;
    const first = this.dirty;
    if (first === FramePhase.length && (!this.continuous.size || this.paused)) return;
    const context = {
      time, delta: this.previousTime === null ? 0 : Math.max(0, time - this.previousTime),
      frame: ++this.frame, inputTime: this.inputTime
    };
    this.previousTime = time;
    this.inputTime = null;
    this.dirty = FramePhase.length;
    this.executing = true;
    try {
      for (let phase = Math.min(first, 2); phase < FramePhase.length; phase++) {
        this.executingPhase = phase;
        if (phase === 2 && this.paused) continue;
        for (const callback of this.callbacks[phase].values()) callback(context);
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.executing = false;
      this.executingPhase = -1;
      if (this.continuous.size && !this.paused) this.dirty = Math.min(this.dirty, 2);
      this.schedule();
    }
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    if (this.request !== null) this.cancelFrame(this.request);
    this.request = null;
    this.continuous.clear();
    for (const callbacks of this.callbacks) callbacks.clear();
  }
}
