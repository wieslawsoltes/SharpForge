import {FileSystemError, throwIfCancelled} from './provider.js';

/** RPC cancellation waits for worker acknowledgement so a completed commit is never reported as aborted. */
export class OpfsWorkerClient {
  constructor(worker) {
    this.worker = worker;
    this.sequence = 0;
    this.pending = new Map();
    this.disposed = false;
    this.message = event => {
      const {id, result, error} = event.data ?? {};
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.cleanup();
      if (error) pending.reject(new FileSystemError(error.code ?? 'Io', error.path, error.message));
      else pending.resolve(result);
    };
    this.failure = event => this.fail(new FileSystemError('Unavailable', '', event.message ?? 'OPFS worker stopped'));
    worker.addEventListener('message', this.message);
    worker.addEventListener('error', this.failure);
  }

  request(method, payload, {signal} = {}) {
    throwIfCancelled(signal);
    if (this.disposed) return Promise.reject(new FileSystemError('Disposed', '', 'OPFS worker is disposed'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const cancel = () => this.worker.postMessage({id, method: 'cancel'});
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      this.pending.set(id, {resolve, reject, cleanup});
      signal?.addEventListener('abort', cancel, {once: true});
      try { this.worker.postMessage({id, method, payload}); }
      catch (error) { this.pending.delete(id); cleanup(); reject(error); }
    });
  }

  fail(error) {
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.message);
    this.worker.removeEventListener('error', this.failure);
    this.worker.terminate();
    this.fail(new FileSystemError('Disposed', '', 'OPFS worker is disposed'));
  }
}
