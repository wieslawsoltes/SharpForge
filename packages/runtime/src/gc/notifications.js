import {ManagedFault} from './fault.js';
import {gcInteger} from './api-arguments.js';

export const GCNotificationStatus = Object.freeze({Succeeded: 0, Failed: 1, Canceled: 2, Timeout: 3, NotApplicable: 4});
const phases = Object.freeze(['approach', 'complete']);

function phaseName(phase) {
  if (!phases.includes(phase)) throw new ManagedFault('ArgumentException', 'Notification phase must be approach or complete');
  return phase;
}

/** Bounded auto-reset notifications with cooperative asynchronous waiting and gen2 hooks. */
export class GCNotifications {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.registration = null;
    this.canceled = false;
    this.pending = {approach: null, complete: null};
    this.waiters = {approach: new Set(), complete: new Set()};
    this.listeners = {approach: new Set(), complete: new Set(), gen2: new Set()};
    this.disposers = new Set();
    this.maxWaiters = gcInteger(options.maxGCNotificationWaiters ?? 1024, 'maxGCNotificationWaiters', 1, 65536);
    this.sequence = 0;
    this.observerErrors = [];
    this.setTimer = options.gcSetTimeout ?? setTimeout;
    this.clearTimer = options.gcClearTimeout ?? clearTimeout;
  }

  register(maxGenerationThreshold, largeObjectHeapThreshold) {
    gcInteger(maxGenerationThreshold, 'maxGenerationThreshold', 1, 99);
    gcInteger(largeObjectHeapThreshold, 'largeObjectHeapThreshold', 1, 99);
    this.resolveAll(GCNotificationStatus.Canceled);
    this.registration = Object.freeze({maxGenerationThreshold, largeObjectHeapThreshold});
    this.canceled = false;
    this.pending = {approach: null, complete: null};
  }

  cancel() {
    this.registration = null;
    this.canceled = true;
    this.pending = {approach: null, complete: null};
    this.resolveAll(GCNotificationStatus.Canceled);
  }

  /** Poll and consume one coalesced phase notification. Timeout=-1 is represented by waitAsync. */
  wait(phase, millisecondsTimeout = 0) {
    phaseName(phase);
    gcInteger(millisecondsTimeout, 'millisecondsTimeout', -1);
    if (this.canceled) return GCNotificationStatus.Canceled;
    if (!this.registration) return GCNotificationStatus.NotApplicable;
    const status = this.pending[phase];
    if (status === null) return GCNotificationStatus.Timeout;
    this.pending[phase] = null;
    return status;
  }

  /** A canceled signal resolves Canceled; timeout=0 polls; timeout=-1 waits until signaled. */
  waitAsync(phase, {millisecondsTimeout = -1, signal} = {}) {
    phaseName(phase);
    gcInteger(millisecondsTimeout, 'millisecondsTimeout', -1);
    if (signal?.aborted) return Promise.resolve(GCNotificationStatus.Canceled);
    const status = this.wait(phase, 0);
    if (status !== GCNotificationStatus.Timeout || millisecondsTimeout === 0) return Promise.resolve(status);
    if (this.waiters.approach.size + this.waiters.complete.size >= this.maxWaiters) {
      throw new ManagedFault('ExecutionLimitException', 'GC notification waiter limit exceeded');
    }
    return new Promise(resolve => {
      let timer = null;
      let settled = false;
      const complete = value => {
        if (settled) return;
        settled = true;
        this.waiters[phase].delete(complete);
        if (timer !== null) this.clearTimer(timer);
        signal?.removeEventListener('abort', cancel);
        resolve(value);
      };
      const cancel = () => complete(GCNotificationStatus.Canceled);
      this.waiters[phase].add(complete);
      signal?.addEventListener('abort', cancel, {once: true});
      if (millisecondsTimeout !== -1) timer = this.setTimer(() => complete(GCNotificationStatus.Timeout), millisecondsTimeout);
    });
  }

  /** Subscribe to approach/complete/gen2; a gen2 callback returning false unregisters itself. */
  subscribe(phase, callback, {signal} = {}) {
    if (!Object.hasOwn(this.listeners, phase) || typeof callback !== 'function') throw new TypeError('Invalid GC notification callback');
    if (this.listeners[phase].size >= this.maxWaiters) throw new RangeError('GC notification callback limit exceeded');
    const subscribed = notification => {
      const keep = callback(notification);
      if (keep === false && phase === 'gen2') dispose();
      return keep;
    };
    const dispose = () => {
      this.listeners[phase].delete(subscribed);
      this.disposers.delete(dispose);
      signal?.removeEventListener('abort', dispose);
    };
    if (!signal?.aborted) {
      this.listeners[phase].add(subscribed);
      this.disposers.add(dispose);
      signal?.addEventListener('abort', dispose, {once: true});
    }
    return Object.freeze({dispose});
  }

  registerGen2Callback(callback, options) {
    return this.subscribe('gen2', callback, options);
  }

  beforeCollection(options = {}) {
    if ((options.generation ?? 2) !== 2) return;
    this.publish('approach', GCNotificationStatus.Succeeded, options);
  }

  afterCollection(stats, options = {}) {
    if ((options.generation ?? 2) !== 2) return;
    const status = options.blocking === false ? GCNotificationStatus.NotApplicable : GCNotificationStatus.Succeeded;
    this.publish('complete', status, {...options, index: stats.collections});
    this.notify('gen2', Object.freeze({generation: 2, index: stats.collections, status}));
  }

  publish(phase, status, details) {
    if (!this.registration) return;
    const waiting = this.waiters[phase].values().next().value;
    if (waiting) waiting(status);
    else this.pending[phase] = status;
    this.notify(phase, Object.freeze({...details, phase, status, sequence: ++this.sequence}));
  }

  notify(phase, notification) {
    for (const callback of [...this.listeners[phase]]) {
      try {
        if (callback(notification) === false && phase === 'gen2') this.listeners[phase].delete(callback);
      } catch (error) {
        if (this.observerErrors.length === 32) this.observerErrors.shift();
        this.observerErrors.push(Object.freeze({id: 'SF-GC-NOTIFY-001', phase, message: String(error?.message ?? error).slice(0, 512)}));
      }
    }
  }

  resolveAll(status) {
    for (const phase of phases) for (const resolve of [...this.waiters[phase]]) resolve(status);
  }

  dispose() {
    this.cancel();
    for (const dispose of [...this.disposers]) dispose();
  }

  snapshot() {
    return {registration: this.registration, canceled: this.canceled, pending: {...this.pending},
      sequence: this.sequence, observerErrors: [...this.observerErrors]};
  }

  restore(state) {
    this.resolveAll(GCNotificationStatus.Canceled);
    this.registration = state.registration;
    this.canceled = state.canceled;
    this.pending = {...state.pending};
    this.sequence = Math.max(this.sequence, state.sequence);
    this.observerErrors = [...state.observerErrors];
  }
}
