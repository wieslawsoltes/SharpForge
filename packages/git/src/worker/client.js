import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { GIT_PROTOCOL_VERSION, GIT_WORKER_LIMITS } from './protocol.js';

/** Multiplex cancellable requests; stale responses cannot complete another session's work. */
export class GitWorkerClient {
  constructor(endpoint, { session = globalThis.crypto.randomUUID(), maxPending = GIT_WORKER_LIMITS.maxPending } = {}) {
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(session)) throw new GitError('Unsafe', 'Invalid Git worker session');
    if (typeof endpoint?.postMessage !== 'function' || typeof endpoint?.addEventListener !== 'function') {
      throw new TypeError('Git worker client requires a message endpoint');
    }
    checkLimit(maxPending, 10000, 'Pending Git worker request limit');
    if (!maxPending) throw new GitError('Limit', 'Pending Git worker request limit must be positive');
    this.endpoint = endpoint;
    this.session = session;
    this.maxPending = maxPending;
    this.nextId = 0;
    this.pending = new Map();
    this.closed = false;
    this.closing = false;
    this.failure = null;
    this.disposal = null;
    this.listener = event => this.receive(event.data);
    this.errorListener = () => this.fail(new GitError('Network', 'Git worker terminated unexpectedly'));
    endpoint.addEventListener('message', this.listener);
    endpoint.addEventListener('error', this.errorListener);
    endpoint.addEventListener('messageerror', this.errorListener);
    endpoint.start?.();
  }

  request(method, params = {}, { signal, onProgress, timeoutMs = 120000 } = {}) {
    return this.#requestMessage(method, params, { signal, onProgress, timeoutMs });
  }

  #requestMessage(method, params, { signal, onProgress, timeoutMs }, disposing = false) {
    if (this.closed || this.closing && !disposing) {
      return Promise.reject(this.failure ?? new GitError('Disposed', 'Git worker client is disposed'));
    }
    try {
      checkCancelled(signal);
      checkLimit(timeoutMs, 2147483647, 'Git worker request deadline');
      if (!timeoutMs) throw new GitError('Limit', 'Git worker request deadline must be positive');
      if (typeof method !== 'string' || !method || method.length > 80) throw new GitError('Corrupt', 'Invalid Git worker operation');
      checkLimit(this.nextId + 1, Number.MAX_SAFE_INTEGER, 'Git worker request identity');
    }
    catch (error) { return Promise.reject(error); }
    if (this.pending.size >= this.maxPending) return Promise.reject(new GitError('Limit', 'Too many pending Git worker requests'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => this.cancel(id, new GitError('Cancelled', 'Git operation cancelled'));
      const finish = (error, result) => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result);
      };
      this.pending.set(id, { finish, onProgress });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => this.cancel(id, new GitError('Network', 'Git worker request deadline exceeded')), timeoutMs);
      try { this.send({ id, type: 'request', method, params }); }
      catch (error) { finish(GitError.from(error)); }
    });
  }

  cancel(id, error) {
    const request = this.pending.get(id);
    if (!request) return;
    // Settle before cancellation delivery: a broken endpoint must not strand the caller.
    request.finish(error);
    try { this.send({ id, type: 'cancel' }); }
    catch { this.fail(new GitError('Network', 'Git worker cancellation could not be delivered')); }
  }

  send(message) {
    this.endpoint.postMessage({ version: GIT_PROTOCOL_VERSION, session: this.session, ...message });
  }

  receive(message) {
    if (message?.version !== GIT_PROTOCOL_VERSION || message.session !== this.session || this.closed) return;
    const request = this.pending.get(message.id);
    if (!request) return;
    try {
      if (message.type === 'progress') request.onProgress?.(message.progress);
      else if (message.type === 'response') {
        const error = message.error ? new GitError(message.error.code, message.error.message, message.error.details) : null;
        request.finish(error, message.result);
      }
    } catch (error) {
      this.cancel(message.id, message.type === 'response' ? new GitError('Corrupt', 'Malformed Git worker response') : GitError.from(error));
    }
  }

  fail(error) {
    this.failure ??= error;
    this.closed = true;
    this.detach();
    for (const request of [...this.pending.values()]) request.finish(error);
  }

  detach() {
    this.endpoint.removeEventListener('message', this.listener);
    this.endpoint.removeEventListener('error', this.errorListener);
    this.endpoint.removeEventListener('messageerror', this.errorListener);
  }

  dispose() {
    if (this.disposal) return this.disposal;
    if (this.closed) return Promise.resolve();
    this.closing = true;
    for (const id of [...this.pending.keys()]) this.cancel(id, new GitError('Cancelled', 'Git worker client disposed'));
    if (this.closed) return Promise.resolve();
    this.disposal = this.#requestMessage('dispose', {}, { timeoutMs: 1000 }, true).finally(() => {
      this.closed = true;
      this.detach();
    });
    return this.disposal;
  }
}
