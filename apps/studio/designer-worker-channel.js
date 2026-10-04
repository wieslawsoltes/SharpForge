import {workerMethods} from './workers/protocol.js';

const omittedErrorFields = new Set(['stack', '__proto__', 'prototype', 'constructor']);

/** Stable transport errors; feature diagnostics keep their original codes and structured details. */
export class DesignerWorkerError extends Error {
  constructor(message, code = 'SFDW0005') {
    super(message);
    this.name = 'DesignerWorkerError';
    this.code = code;
  }
}

/** Serialize diagnostic fields without a stack or prototype-changing properties. */
export function serializeDesignerWorkerError(error) {
  const result = {name: error?.name ?? 'Error', message: error?.message ?? String(error), code: error?.code};
  for (const key of Object.keys(error ?? {})) {
    if (!omittedErrorFields.has(key)) Object.defineProperty(result, key, {
      value: error[key], enumerable: true, configurable: true, writable: true
    });
  }
  return result;
}

function remoteError(value, createError) {
  const error = createError(value?.message || 'Worker request failed', value?.code ?? 'SFDW0005');
  if (typeof value?.name === 'string') error.name = value.name;
  for (const key of Object.keys(value ?? {})) {
    if (!omittedErrorFields.has(key) && !['name', 'message', 'code'].includes(key)) Object.defineProperty(error, key, {
      value: value[key], enumerable: true, configurable: true, writable: true
    });
  }
  return error;
}

/**
 * Own one worker's bounded request map, deadline timers and event listeners.
 * Compiler aborts also cancel queued work by envelope id. Runtime aborts cancel only this caller's wait.
 * Cancellation never terminates the worker; disposal and fatal worker errors do.
 */
export class DesignerWorkerChannel {
  constructor(worker, {
    kind = 'compiler', onEvent = () => {}, onFailure = () => {}, timeout = 30_000, maxPending = 128,
    createError = (message, code) => new DesignerWorkerError(message, code), label = kind
  } = {}) {
    if (!worker?.postMessage || !worker?.addEventListener || !worker?.removeEventListener || !worker?.terminate) {
      throw new TypeError('An independently owned Worker is required');
    }
    if (!Object.hasOwn(workerMethods, kind)) throw new TypeError('Unknown worker kind');
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) throw new RangeError('Invalid worker deadline');
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 512) throw new RangeError('Invalid pending request limit');
    if ([onEvent, onFailure, createError].some(value => typeof value !== 'function')) throw new TypeError('Invalid worker callbacks');
    Object.assign(this, {worker, kind, onEvent, onFailure, timeout, maxPending, createError, label});
    this.methods = new Set(workerMethods[kind]);
    this.pending = new Map();
    this.serial = 0;
    this.disposed = false;
    this.onMessage = event => this.receive(event.data);
    this.onWorkerError = event => this.fail(this.createError(event.message || `${label} worker failed`, 'SFDW0005'));
    this.onMessageError = () => this.fail(this.createError(`${label} worker returned unreadable data`, 'SFDW0005'));
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onWorkerError);
    worker.addEventListener('messageerror', this.onMessageError);
  }

  /** Send validated object parameters. A pre-aborted signal throws before allocating an id or timer. */
  request(method, params = {}, {signal} = {}) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Worker request canceled', 'AbortError');
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('Invalid request cancellation signal');
    }
    if (this.disposed) return Promise.reject(this.createError(`${this.label} worker is disposed`, 'SFDW0002'));
    if (!this.methods.has(method)) return Promise.reject(this.createError(`Unknown ${this.kind} request`, 'SFDW0003'));
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return Promise.reject(new TypeError(`Invalid ${this.kind} parameters`));
    }
    if (this.pending.size >= this.maxPending || this.serial >= Number.MAX_SAFE_INTEGER) {
      return Promise.reject(this.createError(`Too many pending ${this.label} requests`, 'SFDW0006'));
    }
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const canceled = () => this.cancel(id, signal.reason ?? new DOMException('Worker request canceled', 'AbortError'));
      const timer = setTimeout(() => this.cancel(id,
        this.createError(`${this.label} request '${method}' timed out`, 'SFDW0004')), this.timeout);
      const pending = {resolve, reject, signal, canceled, timer, posted: false};
      this.pending.set(id, pending);
      signal?.addEventListener('abort', canceled, {once: true});
      if (signal?.aborted) { canceled(); return; }
      try {
        pending.posted = true;
        this.worker.postMessage({id, method, params});
      } catch (error) {
        this.finish(id, false, error);
      }
    });
  }

  take(id) {
    const pending = this.pending.get(id);
    if (!pending) return null;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener('abort', pending.canceled);
    return pending;
  }

  finish(id, success, value) {
    const pending = this.take(id);
    if (pending) (success ? pending.resolve : pending.reject)(value);
  }

  cancel(id, reason) {
    const pending = this.take(id);
    if (!pending) return;
    if (this.kind === 'compiler' && pending.posted) {
      try {
        // A notification has no reply id and cannot consume another pending request slot.
        this.worker.postMessage({method: 'cancelRequest', params: {requestId: id}});
      } catch (error) {
        // A transport failure is explicit; the shared worker is still not terminated by an abort.
        pending.reject(error);
        return;
      }
    }
    pending.reject(reason);
  }

  receive(message) {
    if (this.disposed || !message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.id !== undefined) {
      if (!this.pending.has(message.id)) return;
      this.finish(message.id, !message.error, message.error ? remoteError(message.error, this.createError) : message.result);
      return;
    }
    if (typeof message.event !== 'string') return;
    try { this.onEvent(message); } catch (error) { this.fail(error); }
  }

  fail(error) {
    if (this.disposed) return;
    this.dispose(error);
    this.onFailure(error);
  }

  dispose(reason = this.createError(`${this.label} worker was closed or restarted`, 'SFDW0002')) {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onWorkerError);
    this.worker.removeEventListener('messageerror', this.onMessageError);
    for (const id of this.pending.keys()) this.finish(id, false, reason);
    this.worker.terminate();
  }
}
