import {captureBackgroundGraph} from './background-graph.js';
import {ManagedFault} from './fault.js';

/** Browser availability is explicit; an injected Node worker is only a test adapter. */
export function backgroundMarkCapabilities(environment = globalThis) {
  const reasons = [];
  if (typeof environment.Worker !== 'function') reasons.push('Worker is unavailable');
  if (typeof environment.SharedArrayBuffer !== 'function') reasons.push('SharedArrayBuffer is unavailable');
  if (typeof environment.Atomics !== 'object') reasons.push('Atomics is unavailable');
  if (environment.crossOriginIsolated !== true) reasons.push('Cross-origin isolation (COOP/COEP) is required');
  return {supported: reasons.length === 0, reasons};
}

/** Disabled-by-default mark-only prototype. Production reclamation remains with Collector. */
export class BackgroundMarker {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.enabled = options.backgroundMarking === true;
    this.environment = options.backgroundEnvironment ?? globalThis;
    this.workerFactory = options.backgroundWorkerFactory ?? ((url, workerOptions) => new this.environment.Worker(url, workerOptions));
    this.timeoutMs = options.backgroundTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000) {
      throw new RangeError('Invalid background marking timeout');
    }
    this.maxNewAllocations = options.backgroundMaxNewAllocations ?? 1_000_000;
    if (!Number.isSafeInteger(this.maxNewAllocations) || this.maxNewAllocations < 1 || this.maxNewAllocations > 1_000_000) {
      throw new RangeError('Invalid background allocation tracking limit');
    }
    this.nextId = 1;
    this.pending = null;
    this.closed = false;
  }

  capabilities() {
    return {...backgroundMarkCapabilities(this.environment), enabled: this.enabled, mode: 'mark-only-satb'};
  }

  writeBarrier(reference) {
    const pending = this.pending;
    if (!pending) return;
    const index = pending.capture.indices.get(reference?.h);
    if (index === undefined || pending.capture.references[index].g !== reference.g) return;
    Atomics.store(pending.cards, index, 1);
  }

  allocated(reference) {
    const pending = this.pending;
    if (!pending) return;
    if (!pending.allocations.has(reference.h) && pending.allocations.size >= this.maxNewAllocations) {
      this._finish(pending, null, new ManagedFault('ExecutionLimitException', 'Background allocation tracking limit exceeded'));
      return;
    }
    // Reused handles replace dead allocation identities instead of accumulating churn.
    pending.allocations.set(reference.h, reference);
  }

  mark(extraRoots = [], options = {}) {
    if (this.closed) return Promise.reject(new ManagedFault('ObjectDisposedException', 'Background marker is disposed'));
    if (!this.enabled) return Promise.resolve({status: 'disabled', reason: 'Background marking is disabled', mode: 'mark-only-satb'});
    const capability = this.capabilities();
    if (!capability.supported) return Promise.resolve({status: 'unsupported', reasons: capability.reasons, mode: 'mark-only-satb'});
    if (this.pending) return Promise.reject(new ManagedFault('InvalidOperationException', 'Background marking is already active'));
    let capture;
    try {
      const action = () => captureBackgroundGraph(this.heap, extraRoots, options);
      capture = this.heap.safepoints ? this.heap.safepoints.withSuspension(action, {reason: 'BackgroundSnapshot'}) : action();
    } catch (error) {
      if (error.name === 'NotSupportedException') return Promise.resolve({status: 'unsupported', reasons: [error.message]});
      return Promise.reject(error);
    }
    return this._run(capture);
  }

  _run(capture) {
    return new Promise((resolve, reject) => {
      const worker = this.workerFactory(new URL('./background-worker.js', import.meta.url), {type: 'module', name: 'SharpForge GC mark'});
      const id = this.nextId++;
      const pending = {
        id, worker, capture, resolve, reject, timer: null, allocations: new Map(),
        messageAttached: false, failureAttached: false,
        cards: new Int32Array(capture.graph.cards), status: new Int32Array(capture.graph.status)
      };
      this.pending = pending;
      const message = event => {
        if (this.pending !== pending || event.data?.id !== id) return;
        if (event.data.kind === 'error') {
          const error = new Error(event.data.error?.message ?? 'Background worker failed');
          error.name = event.data.error?.name ?? 'Error';
          this._finish(pending, null, error);
        } else if (event.data.kind === 'result') this._complete(pending, event.data.result);
      };
      const failure = event => this._finish(pending, null, new Error(event?.message ?? 'Background worker failed'));
      pending.message = message;
      pending.failure = failure;
      try {
        if (typeof worker?.addEventListener !== 'function' || typeof worker.removeEventListener !== 'function' ||
            typeof worker.postMessage !== 'function' || typeof worker.terminate !== 'function') {
          throw new TypeError('Invalid background worker adapter');
        }
        pending.messageAttached = true;
        worker.addEventListener('message', message);
        pending.failureAttached = true;
        worker.addEventListener('error', failure);
        pending.timer = setTimeout(() => this._finish(pending, null, new Error('Background marking timed out')), this.timeoutMs);
        worker.postMessage({kind: 'mark', id, graph: capture.graph});
      } catch (error) {
        this._finish(pending, null, error);
      }
    });
  }

  _complete(pending, workerResult) {
    if (!workerResult || !['complete', 'cancelled'].includes(workerResult.status)) {
      this._finish(pending, null, new Error('Invalid background worker result'));
      return;
    }
    const marks = new Int32Array(pending.capture.graph.marks);
    const reachable = [];
    let dirtyObjects = 0;
    for (let index = 0; index < marks.length; index++) {
      if (Atomics.load(marks, index)) reachable.push(pending.capture.references[index]);
      if (Atomics.load(pending.cards, index)) dirtyObjects++;
    }
    const newAllocations = [];
    for (const reference of pending.allocations.values()) {
      if (this.heap.tryGet(reference)) newAllocations.push(reference);
    }
    this._finish(pending, {
      status: workerResult.status, mode: 'mark-only-satb', reachable,
      markedObjects: reachable.length, dirtyObjects, newAllocations,
      allocationSerial: pending.capture.allocationSerial, reclaimedObjects: 0
    });
  }

  _finish(pending, result, error = null) {
    if (this.pending !== pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    const failures = error ? [error] : [];
    try {
      if (pending.messageAttached) pending.worker.removeEventListener('message', pending.message);
    } catch (failure) {
      failures.push(failure);
    }
    try {
      if (pending.failureAttached) pending.worker.removeEventListener('error', pending.failure);
    } catch (failure) {
      failures.push(failure);
    }
    try {
      if (typeof pending.worker?.terminate === 'function') pending.worker.terminate();
    } catch (failure) {
      failures.push(failure);
    }
    if (failures.length) {
      pending.reject(failures.length === 1 ? failures[0] : new AggregateError(failures, 'Background worker shutdown failed'));
    }
    else pending.resolve(result);
  }

  cancel() {
    const pending = this.pending;
    if (!pending) return false;
    Atomics.store(pending.status, 0, 1);
    this._finish(pending, {status: 'cancelled', mode: 'mark-only-satb', reclaimedObjects: 0});
    return true;
  }

  dispose() {
    this.cancel();
    this.closed = true;
  }

  snapshot() {
    if (this.pending) throw new ManagedFault('InvalidOperationException', 'Complete or cancel background marking before snapshot');
    return {enabled: this.enabled, closed: this.closed, nextId: this.nextId, maxNewAllocations: this.maxNewAllocations};
  }

  restore(state) {
    this.cancel();
    this.enabled = !!state.enabled;
    this.closed = !!state.closed;
    this.maxNewAllocations = state.maxNewAllocations ?? this.maxNewAllocations;
    this.nextId = Math.max(this.nextId, state.nextId);
  }
}
