import {ManagedFault} from '../heap.js';

const terminal = new Set(['completed', 'faulted', 'canceled']);

/** Native waiters observe context completion without polling or adding work to the instruction hot path. */
export class ContextCompletions {
  constructor(scheduler, {maximum = 4096} = {}) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4096) throw new RangeError('Invalid context observer limit');
    this.scheduler = scheduler;
    this.maximum = maximum;
    this.waiters = new Map();
    this.count = 0;
  }

  wait(id, {signal} = {}) {
    try {
      signal?.throwIfAborted();
      const context = this.scheduler.contexts.get(id);
      if (!context) throw new ManagedFault('InvalidOperationException', 'Unknown managed execution context');
      if (terminal.has(context.status)) return this.result(context);
      if (this.count >= this.maximum) throw new ManagedFault('ExecutionLimitException', 'Managed context observer limit');
      const waiter = {id, signal, settled: false, resolve: null, reject: null, abort: null};
      const promise = new Promise((resolve, reject) => { waiter.resolve = resolve; waiter.reject = reject; });
      waiter.abort = () => this.finish(waiter, null, signal.reason ??
        new ManagedFault('OperationCanceledException', 'Managed context observation was canceled'));
      let entries = this.waiters.get(id);
      if (!entries) this.waiters.set(id, entries = new Set());
      entries.add(waiter);
      this.count++;
      signal?.addEventListener('abort', waiter.abort, {once: true});
      return promise;
    } catch (error) { return Promise.reject(error); }
  }

  result(context) {
    if (context.status === 'completed') return Promise.resolve({id: context.id, status: context.status});
    return Promise.reject(context.fault ?? new ManagedFault('OperationCanceledException', 'Managed execution context was canceled'));
  }

  finish(waiter, value, error) {
    if (waiter.settled) return;
    waiter.settled = true;
    const entries = this.waiters.get(waiter.id);
    entries?.delete(waiter);
    if (!entries?.size) this.waiters.delete(waiter.id);
    this.count--;
    waiter.signal?.removeEventListener('abort', waiter.abort);
    if (error) waiter.reject(error);
    else waiter.resolve(value);
  }

  complete(context) {
    if (!terminal.has(context.status)) return;
    const entries = this.waiters.get(context.id);
    if (!entries) return;
    const error = context.status === 'completed' ? null : context.fault ??
      new ManagedFault('OperationCanceledException', 'Managed execution context was canceled');
    for (const waiter of entries) this.finish(waiter, {id: context.id, status: context.status}, error);
  }

  cancelAll(message = 'Managed execution was canceled') {
    const error = new ManagedFault('OperationCanceledException', message);
    for (const entries of this.waiters.values()) for (const waiter of entries) this.finish(waiter, null, error);
  }
}
