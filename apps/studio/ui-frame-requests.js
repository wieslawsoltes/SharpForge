const cancelled = message => Object.assign(new Error(message), {name: 'AbortError'});

/** A frame acknowledgement comes from the application's shared host scheduler, never a worker timer. */
export class HostUIFrameRequests {
  constructor(scheduler, {isPaused = () => false} = {}) {
    this.scheduler = scheduler;
    this.isPaused = isPaused;
    this.pending = new Set();
    this.closed = false;
  }
  request(payload, {signal} = {}) {
    if (!payload || payload.version !== 1 || Object.keys(payload).length !== 1) return Promise.reject(new TypeError('Invalid host frame request'));
    if (this.closed) return Promise.reject(cancelled('The host frame session ended'));
    if (this.pending.size >= 64) return Promise.reject(new RangeError('Host frame request limit exceeded'));
    if (signal?.aborted) return Promise.reject(signal.reason ?? cancelled('The host frame request was cancelled'));
    return new Promise((resolve, reject) => {
      const entry = {unregister: null, cancel: null};
      const finish = (value, error) => {
        if (!this.pending.delete(entry)) return;
        entry.unregister?.();
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => finish(null, signal.reason ?? cancelled('The host frame request was cancelled'));
      entry.cancel = () => finish(null, cancelled('The host frame session ended'));
      this.pending.add(entry);
      try {
        entry.unregister = this.scheduler.register('input', entry, context => {
          if (!this.isPaused()) finish({version: 1, frame: context.frame, time: context.time});
        });
        signal?.addEventListener('abort', abort, {once: true});
        if (!this.isPaused()) this.scheduler.invalidate('input');
      } catch (error) { finish(null, error); }
    });
  }
  resumed() { if (!this.closed && this.pending.size) this.scheduler.invalidate('input'); }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.pending]) entry.cancel();
  }
}
