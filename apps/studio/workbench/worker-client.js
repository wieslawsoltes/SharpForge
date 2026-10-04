import { workerMethods } from '../workers/protocol.js';
import { WorkbenchEvents, abortError, workbenchError } from './state-events.js';

/** One worker connection; request IDs and generations reject late replies after restart. */
export class WorkerClient {
  constructor(url, options = {}) {
    if (typeof options === 'function') options = { onEvent: options };
    this.url = url;
    this.options = options;
    this.factory = options.workerFactory ?? ((workerUrl, settings) => new Worker(workerUrl, settings));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxPending = options.maxPending ?? 1024;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new RangeError('Invalid worker timeout');
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) throw new RangeError('Invalid pending request limit');
    if (options.kind && !workerMethods[options.kind]) throw new TypeError('Unknown worker protocol');
    this.methods = options.kind ? new Set(workerMethods[options.kind]) : null;
    this.events = new WorkbenchEvents();
    this.pending = new Map();
    this.next = 0;
    this.generation = 0;
    this.disposed = false;
    this.failed = false;
    this.lastError = null;
    this.connect();
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  connect() {
    const generation = ++this.generation;
    const worker = this.factory(this.url, { type: 'module', name: this.options.name });
    if (!worker || typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function') {
      throw new TypeError('Worker factory must return a Worker-compatible object');
    }
    this.worker = worker;
    this.failed = false;
    worker.onmessage = event => {
      if (this.disposed || generation !== this.generation || worker !== this.worker) return;
      this.receive(event.data, generation);
    };
    worker.onerror = event => {
      if (this.disposed || generation !== this.generation) return;
      const error = workbenchError('WORKER_FAILED', event.message || 'Worker failed to initialize', event.error);
      this.failed = true;
      this.rejectAll(error);
      this.report(error);
    };
    worker.onmessageerror = () => {
      if (this.disposed || generation !== this.generation) return;
      const error = workbenchError('WORKER_MESSAGE', 'Worker reply could not be deserialized');
      this.rejectAll(error);
      this.report(error);
    };
  }

  receive(message, generation) {
    if (!message || typeof message !== 'object') {
      this.report(workbenchError('WORKER_MESSAGE', 'Malformed worker reply'));
      return;
    }
    if (typeof message.event === 'string') {
      const envelope = Object.freeze({ type: 'event', event: message, generation });
      this.options.onEvent?.(message, envelope);
      this.events.emit(envelope);
      return;
    }
    const request = this.pending.get(message.id);
    if (!request || request.generation !== generation) return;
    this.finish(message.id);
    if (message.error) {
      const error = workbenchError(message.error.code ?? 'WORKER_REQUEST', message.error.message ?? 'Worker request failed');
      error.name = message.error.name ?? 'WorkerError';
      request.reject(error);
    } else request.resolve(message.result);
  }

  /** Cancellation rejects the caller; cancelAll/restart also terminates synchronous worker work. */
  request(method, params = {}, { signal, timeoutMs = this.timeoutMs, transfer = [] } = {}) {
    if (this.disposed) return Promise.reject(workbenchError('WORKER_DISPOSED', 'Worker client is disposed'));
    if (this.failed) return Promise.reject(workbenchError('WORKER_FAILED', 'Restart the failed worker before requesting work'));
    if (this.options.transformRequest) {
      try {
        const transformed = this.options.transformRequest(method, params, { generation: this.generation, client: this });
        if (transformed?.method) ({ method, params } = transformed);
        else if (transformed !== undefined) params = transformed;
      } catch (error) { return Promise.reject(error); }
    }
    if (typeof method !== 'string' || !method || this.methods && !this.methods.has(method)) {
      return Promise.reject(workbenchError('UNKNOWN_METHOD', `Unknown ${this.options.kind ?? 'worker'} request '${method}'`));
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new TypeError('Invalid request parameters'));
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new RangeError('Invalid request timeout'));
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    if (this.pending.size >= this.maxPending) return Promise.reject(workbenchError('WORKER_QUOTA', 'Too many pending worker requests'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!this.pending.has(id)) return;
        this.finish(id);
        reject(abortError(signal.reason));
      };
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.finish(id);
        reject(workbenchError('WORKER_TIMEOUT', `Worker request '${method}' timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, signal, abort, generation: this.generation });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.worker.postMessage({ id, method, params }, transfer); }
      catch (error) {
        this.finish(id);
        reject(workbenchError('WORKER_SEND', `Could not send '${method}' to worker`, error));
      }
    });
  }

  finish(id) {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    clearTimeout(request.timer);
    request.signal?.removeEventListener('abort', request.abort);
  }

  rejectAll(error) {
    for (const [id, request] of this.pending) {
      this.finish(id);
      request.reject(error);
    }
  }

  report(error) {
    this.lastError = error;
    this.events.emit({ type: 'error', error, generation: this.generation });
    this.options.onError?.(error);
  }

  restart(reason = workbenchError('WORKER_RESTARTED', 'Worker restarted')) {
    if (this.disposed) throw workbenchError('WORKER_DISPOSED', 'Worker client is disposed');
    this.rejectAll(reason);
    this.worker.terminate();
    this.connect();
    this.events.emit({ type: 'restarted', generation: this.generation });
    return this.generation;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.rejectAll(workbenchError('WORKER_DISPOSED', 'Worker client is disposed'));
    this.worker.terminate();
    this.events.dispose();
  }
}
