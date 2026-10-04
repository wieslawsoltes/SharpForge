/** Lazy portable worker transport. Cancellation has a hard fallback for code that cannot reach a cooperative VM slice. */
export class PortableWorkerTestAdapter {
  constructor({createWorker = () => new Worker(new URL('./test.worker.js', import.meta.url), {type: 'module'})} = {}) {
    this.id = 'portable-managed';
    this.createWorker = createWorker;
    this.worker = null;
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
  }

  ensure() {
    if (this.closed) throw new Error('Portable test client is disposed');
    if (this.worker) return;
    this.worker = this.createWorker();
    this.worker.onmessage = event => {
      const message = event.data;
      const pending = this.pending.get(message.requestId ?? message.id);
      if (!pending) return;
      if (message.event === 'progress') return pending.onEvent?.(message.value);
      if (message.event === 'session') return pending.onSession?.(message.session);
      message.error ? pending.reject(Object.assign(new Error(message.error.message), message.error)) : pending.resolve(message.result);
    };
    this.worker.onerror = event => this.stop(new Error(event.message ?? 'Portable test worker failed'));
  }

  request(method, params, {signal, onEvent, onSession} = {}) {
    signal?.throwIfAborted();
    this.ensure();
    if (this.pending.size) throw new Error('Finish the active portable test operation first');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let cancelTimer = null;
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(cancelTimer);
        signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      const abort = () => {
        this.worker?.postMessage({method: 'cancel', params: {requestId: id}});
        cancelTimer = setTimeout(() => this.stop(new DOMException('Portable test operation cancelled', 'AbortError')), 1000);
      };
      const timer = setTimeout(() => this.stop(new Error('Portable test worker exceeded its time limit')),
        Math.min(3900000, (params.timeoutMs ?? 30000) + 30000));
      this.pending.set(id, {onEvent, onSession,
        resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); }});
      signal?.addEventListener('abort', abort, {once: true});
      try { this.worker.postMessage({id, method, params}); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  discover(input, options) { return this.request('discover', input, options); }
  run(input, options) { return this.request('run', input, options); }

  cancel() {
    for (const requestId of this.pending.keys()) this.worker?.postMessage({method: 'cancel', params: {requestId}});
  }

  stop(error) {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    for (const request of [...this.pending.values()]) request.reject(error);
  }

  close() {
    this.closed = true;
    this.stop(new DOMException('Portable test client disposed', 'AbortError'));
  }
}
