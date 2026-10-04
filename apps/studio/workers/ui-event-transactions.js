import {uiEventFailure} from './ui-event-protocol.js';

/** A bounded set of cancellable decisions shared by the browser client and worker receiver. */
export class UIEventTransactions {
  constructor({maximum = 64, timeout = 30000, schedule = setTimeout, cancel = clearTimeout} = {}) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64
      || !Number.isFinite(timeout) || timeout < 1 || timeout > 30000
      || typeof schedule !== 'function' || typeof cancel !== 'function') throw new RangeError('Invalid UI event request limits');
    Object.assign(this, {maximum, timeout, schedule, cancel});
    this.pending = new Map();
    this.closed = false;
  }

  begin(id, {signal} = {}) {
    if (this.closed) throw uiEventFailure('AbortError', 'UI event channel is closed');
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(id) || id < 1 || this.pending.has(id)) throw new TypeError('Invalid or duplicate UI event request identity');
    if (this.pending.size >= this.maximum) throw uiEventFailure('QuotaExceededError', 'UI event pending-request limit exceeded');
    const entry = {id, controller: new AbortController(), signal, abort: null, timer: null, resolve: null, reject: null};
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entry.abort = () => this.reject(entry, signal.reason ?? uiEventFailure('AbortError', 'UI event request was canceled'));
    this.pending.set(id, entry);
    try {
      signal?.addEventListener('abort', entry.abort, {once: true});
      entry.timer = this.schedule(() => this.reject(entry, uiEventFailure('TimeoutError', 'UI event request timed out')), this.timeout);
      if (this.pending.get(id) !== entry) this.cancel(entry.timer);
      if (signal?.aborted) entry.abort();
    } catch (error) { this.reject(entry, error); }
    return entry;
  }

  finish(entry, value, error) {
    if (this.pending.get(entry.id) !== entry) return false;
    this.pending.delete(entry.id);
    try {
      if (entry.timer !== null) this.cancel(entry.timer);
      entry.signal?.removeEventListener('abort', entry.abort);
    } catch (failure) { error ??= failure; }
    if (error) {
      entry.controller.abort(error);
      entry.reject(error);
    } else entry.resolve(value);
    return true;
  }

  resolve(entry, value) { return this.finish(entry, value, null); }
  reject(entry, error) { return this.finish(entry, null, error); }
  cancelRequest(id, error = uiEventFailure('AbortError', 'UI event request was canceled')) {
    const entry = this.pending.get(id);
    return entry ? this.reject(entry, error) : false;
  }
  cancelAll(message = 'UI event session ended') {
    const error = uiEventFailure('AbortError', message);
    for (const entry of this.pending.values()) this.reject(entry, error);
  }
  dispose() { this.closed = true; this.cancelAll(); }
}
