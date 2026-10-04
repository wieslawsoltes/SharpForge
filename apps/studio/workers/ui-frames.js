const aborted = message => Object.assign(new Error(message), {name: 'AbortError'});

/** Native callbacks stay in the worker; one bounded host-frame request serves all pending owner queues. */
export class RuntimeUIFrames {
  constructor(bridge, {maximum = 4096, perFrame = 64} = {}) {
    if (![maximum, perFrame].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 4096) || perFrame > maximum) {
      throw new RangeError('Invalid UI frame callback limit');
    }
    this.bridge = bridge;
    this.maximum = maximum;
    this.perFrame = perFrame;
    this.callbacks = new Map();
    this.nextId = 1;
    this.pending = null;
    this.delivery = null;
    this.closed = false;
    this.failed = false;
  }
  requestFrame(callback) {
    if (this.closed || this.bridge.closed) throw aborted('The UI frame session ended');
    if (typeof callback !== 'function') throw new TypeError('A UI frame callback is required');
    if (this.callbacks.size >= this.maximum || this.nextId >= Number.MAX_SAFE_INTEGER) throw new RangeError('UI frame callback limit exceeded');
    const token = this.nextId++;
    this.callbacks.set(token, callback);
    this.schedule();
    return token;
  }
  cancelFrame(token) {
    const removed = this.callbacks.delete(token);
    if (!this.callbacks.size) {
      this.delivery = null;
      this.cancelPending();
    }
    return removed;
  }
  cancelPending() {
    const pending = this.pending;
    this.pending = null;
    pending?.controller.abort(aborted('The UI frame request was cancelled'));
  }
  observe() {
    if (this.bridge.vm?.state === 'paused' || this.bridge.vm?.state === 'faulted') this.cancelPending();
    else this.schedule();
  }
  schedule() {
    const {bridge} = this;
    if (this.closed || this.failed || bridge.closed || !bridge.vm || this.pending || this.delivery || !this.callbacks.size
      || ['paused', 'faulted'].includes(bridge.vm.state)) return;
    const pending = {controller: new AbortController(), vm: bridge.vm};
    this.pending = pending;
    bridge.request('bindingFrame', {version: 1}, {signal: pending.controller.signal}).then(value => {
      if (this.closed || this.pending !== pending || bridge.vm !== pending.vm) return;
      this.pending = null;
      if (value?.version !== 1 || !Number.isFinite(value.time) || value.time < 0
        || !Number.isSafeInteger(value.frame) || value.frame < 1) throw new TypeError('Invalid host frame acknowledgement');
      const delivery = {vm: pending.vm, time: value.time, callbacks: [...this.callbacks].slice(0, this.perFrame)};
      this.delivery = delivery;
      // Dispatcher ownership keeps callback execution outside paused or isolated interpreter frames.
      bridge.vm.platform.ui.scheduleUI(() => this.deliver(delivery));
    }).catch(error => {
      if (this.closed || pending.controller.signal.aborted || bridge.vm !== pending.vm) return;
      if (this.pending === pending) this.pending = null;
      this.failed = true;
      bridge.onError(error);
    });
  }
  deliver(delivery) {
    if (this.closed || this.delivery !== delivery || this.bridge.vm !== delivery.vm) return;
    if (['paused', 'faulted'].includes(delivery.vm.state)) { this.delivery = null; return; }
    try {
      for (const [token, callback] of delivery.callbacks) {
        if (this.callbacks.get(token) !== callback) continue;
        this.callbacks.delete(token);
        try { callback(delivery.time); } catch (error) { this.bridge.onError(error); }
      }
    } finally { this.delivery = null; this.schedule(); }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.callbacks.clear();
    this.delivery = null;
    this.cancelPending();
  }
}
