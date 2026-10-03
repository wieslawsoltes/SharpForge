import {workerMethods} from './workers/protocol.js';
import {DesignerAppHostError, assertAppSignal} from './designer-app-host-errors.js';

/** A single worker's request channel. Request ids, deadlines and disposal belong to this instance. */
export class DesignerAppWorkerChannel {
  constructor(worker, {onEvent = () => {}, onFailure = () => {}, timeout = 30_000, maxPending = 128} = {}) {
    if (!worker?.postMessage || !worker?.addEventListener || !worker?.removeEventListener || !worker?.terminate) {
      throw new TypeError('An independently owned Worker is required');
    }
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) throw new RangeError('Invalid worker deadline');
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 512) throw new RangeError('Invalid pending request limit');
    Object.assign(this, {worker, onEvent, onFailure, timeout, maxPending});
    this.pending = new Map();
    this.serial = 0;
    this.disposed = false;
    this.onMessage = event => this.receive(event.data);
    this.onWorkerError = event => this.fail(new DesignerAppHostError(event.message || 'App worker failed', 'SFDA0005'));
    this.onMessageError = () => this.fail(new DesignerAppHostError('App worker returned unreadable data', 'SFDA0005'));
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onWorkerError);
    worker.addEventListener('messageerror', this.onMessageError);
  }

  request(method, params = {}, {signal} = {}) {
    assertAppSignal(signal);
    if (this.disposed) return Promise.reject(new DesignerAppHostError('App worker is disposed', 'SFDA0002'));
    if (!workerMethods.runtime.includes(method)) return Promise.reject(new DesignerAppHostError('Unknown runtime request', 'SFDA0003'));
    if (!params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new TypeError('Invalid runtime parameters'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new DesignerAppHostError('Too many pending app requests', 'SFDA0006'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const canceled = () => this.finish(id, false, signal.reason ?? new DOMException('App request canceled', 'AbortError'));
      const timer = setTimeout(() => this.finish(id, false, new DesignerAppHostError(`App request '${method}' timed out`, 'SFDA0004')),
        this.timeout);
      this.pending.set(id, {resolve, reject, signal, canceled, timer});
      signal?.addEventListener('abort', canceled, {once: true});
      try {
        this.worker.postMessage({id, method, params});
      } catch (error) {
        this.finish(id, false, error);
      }
    });
  }

  finish(id, success, value) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.canceled);
    (success ? pending.resolve : pending.reject)(value);
  }

  receive(message) {
    if (this.disposed || !message || typeof message !== 'object') return;
    if (message.id !== undefined) {
      const error = message.error;
      this.finish(message.id, !error, error ? new DesignerAppHostError(error.message || 'App request failed', error.code ?? 'SFDA0005') :
        message.result);
      return;
    }
    if (typeof message.event !== 'string') return;
    try {
      this.onEvent(message);
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error) {
    if (this.disposed) return;
    this.dispose(error);
    this.onFailure(error);
  }

  dispose(reason = new DesignerAppHostError('App worker was closed or restarted', 'SFDA0002')) {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.removeEventListener('messageerror', this.onMessageError);
    for (const id of this.pending.keys()) this.finish(id, false, reason);
    this.worker.terminate();
  }
}
