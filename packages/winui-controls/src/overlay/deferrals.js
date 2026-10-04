import { ControlError } from '../policy/events.js';

/** Bounded event deferrals. Completion is idempotent; callers must seal after dispatch. */
export class DeferralGroup {
  constructor({ timeout = 5000, signal, schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.controller = new AbortController();
    this.pending = 1;
    this.sealed = false;
    this.finished = false;
    this.cancelTimer = cancel;
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.timer = schedule(() => this.fail(new ControlError('SFUI1660', 'The event deferral deadline expired')), Math.max(1, timeout));
    this.abort = () => this.fail(signal.reason ?? new DOMException('Operation aborted', 'AbortError'));
    this.signal = signal;
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }

  getDeferral() {
    if (this.sealed || this.finished) throw new ControlError('SFUI1661', 'The event is no longer accepting deferrals');
    this.pending++;
    let completed = false;
    const complete = () => { if (!completed) { completed = true; this.complete(); } };
    return Object.freeze({ complete, Complete: complete });
  }

  seal() { if (!this.sealed) { this.sealed = true; this.complete(); } return this.promise; }
  complete() { if (!this.finished && --this.pending === 0) this.finish(); }
  finish() { this.finished = true; this.cleanup(); this.resolve(); }
  fail(error) { if (this.finished) return; this.finished = true; this.controller.abort(error); this.cleanup(); this.reject(error); }
  cleanup() { this.cancelTimer(this.timer); this.signal?.removeEventListener('abort', this.abort); }
  dispose() { this.fail(new ControlError('SFUI1662', 'The deferred operation was disposed')); }
}

export async function dispatchDeferred(source, name, values = {}, options = {}) {
  const group = new DeferralGroup(options);
  const args = { ...values, Cancel: false, GetDeferral: () => group.getDeferral() };
  Object.defineProperty(args, 'requestSignal', { value: group.controller.signal });
  try { source.emit(name, args); }
  catch (error) { group.fail(error); }
  await group.seal();
  return args;
}
