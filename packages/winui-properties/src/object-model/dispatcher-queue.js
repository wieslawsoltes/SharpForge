export const DispatcherQueuePriority = Object.freeze({Low: -10, Normal: 0, High: 10});

/** A bounded logical-UI-thread queue; each priority is FIFO and every drain has an explicit work budget. */
export class DispatcherQueue {
  constructor({schedule = null, invoke = callback => callback(), currentThread = () => 'ui', uiThread = 'ui',
    enterThread = action => action(), maxPending = 100000, maxCallbacksPerDrain = 256, onError = null} = {}) {
    Object.assign(this, {schedule, invoke, currentThread, uiThread, enterThread, maxPending, maxCallbacksPerDrain, onError});
    this.queues = [[], [], []];
    this.heads = [0, 0, 0];
    this.pending = 0;
    this.scheduled = false;
    this.draining = false;
    this.closed = false;
    this.shutdownListeners = new Set();
    this.drainCallback = () => this.drain();
  }

  get hasThreadAccess() { return this.draining || this.currentThread() === this.uiThread; }

  tryEnqueue(callback, priority = DispatcherQueuePriority.Normal) {
    const index = priority === 10 ? 0 : priority === 0 ? 1 : priority === -10 ? 2 : -1;
    if (index < 0) throw new RangeError('Dispatcher priority must be High, Normal or Low.');
    if (callback === null || callback === undefined) throw new TypeError('A dispatcher callback is required.');
    if (this.closed || this.pending >= this.maxPending) return false;
    this.queues[index].push(callback);
    this.pending++;
    this.requestDrain();
    return true;
  }

  requestDrain() {
    if (!this.pending || this.scheduled || this.draining || !this.schedule || this.closed) return;
    this.scheduled = true;
    this.schedule(this.drainCallback);
  }

  drain({maxCallbacks = this.maxCallbacksPerDrain} = {}) {
    if (this.draining || this.closed) return 0;
    if (!Number.isInteger(maxCallbacks) || maxCallbacks < 1) throw new RangeError('Dispatcher drain budget must be positive.');
    this.scheduled = false;
    this.draining = true;
    let completed = 0;
    try {
      this.enterThread(() => {
        while (this.pending && completed < maxCallbacks && !this.closed) {
          const index = this.queues.findIndex((queue, priority) => this.heads[priority] < queue.length);
          const queue = this.queues[index];
          const callback = queue[this.heads[index]++];
          this.pending--;
          completed++;
          try { this.invoke(callback); }
          catch (error) { if (this.onError) this.onError(error); else throw error; }
          if (this.heads[index] === queue.length) { queue.length = 0; this.heads[index] = 0; }
        }
      });
    } finally {
      this.draining = false;
      this.requestDrain();
    }
    return completed;
  }

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    this.pending = 0;
    for (const queue of this.queues) queue.length = 0;
    this.heads.fill(0);
    for (const listener of [...this.shutdownListeners]) listener();
    this.shutdownListeners.clear();
  }

  onShutdown(listener) { this.shutdownListeners.add(listener); return () => this.shutdownListeners.delete(listener); }
  snapshot() {
    return {version: 1, queues: this.queues.map((queue, index) => queue.slice(this.heads[index])), closed: this.closed,
      scheduled: this.scheduled, shutdownListeners: [...this.shutdownListeners]};
  }
  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.queues.length !== 3) throw new TypeError('Invalid dispatcher snapshot.');
    this.queues = snapshot.queues.map(queue => [...queue]);
    this.heads.fill(0);
    this.pending = this.queues.reduce((sum, queue) => sum + queue.length, 0);
    this.closed = snapshot.closed;
    this.scheduled = snapshot.scheduled;
    this.shutdownListeners = new Set(snapshot.shutdownListeners);
    this.draining = false;
  }
  *retainedValues() {
    for (let index = 0; index < 3; index++) {
      for (let offset = this.heads[index]; offset < this.queues[index].length; offset++) {
        const callback = this.queues[index][offset];
        yield callback;
        if (callback.retainedValues) yield* callback.retainedValues();
      }
    }
  }
  dispose() { this.shutdown(); }
}
