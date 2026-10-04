import {cancellable} from '../events.js';
import {executionMetric} from '../../workers/execution-occupancy.js';

function invalid(message) { return Object.assign(new Error(message), {code: 'PROFILE_RESULT'}); }

/** Validate the entire reply before committing any sample to its app/launch history. */
export function validateExecutionBatch(batch, {sessionId, after = 0, limit = 256, previousEnd = 0} = {}) {
  if (!batch || batch.metric !== executionMetric || batch.sessionId !== sessionId || !Array.isArray(batch.samples) || batch.samples.length > limit ||
      !Number.isSafeInteger(batch.sequence) || batch.sequence < after || !Number.isSafeInteger(batch.firstSequence) || batch.firstSequence < 1 ||
      batch.firstSequence > Math.max(1, batch.sequence) || batch.truncated !== (batch.firstSequence > after + 1) ||
      !Number.isFinite(batch.intervalMs) || batch.intervalMs < 50 || batch.intervalMs > 5000 ||
      typeof batch.active !== 'boolean' || !Number.isFinite(batch.totalBusyMs) || batch.totalBusyMs < 0) {
    throw invalid('Invalid execution capture identity or header');
  }
  const start = Math.max(batch.firstSequence, after + 1);
  if (batch.samples.length !== Math.min(limit, Math.max(0, batch.sequence - start + 1))) throw invalid('Execution capture omitted sequence obligations');
  let sequence = start - 1, end = previousEnd, observedBusy = 0;
  for (const sample of batch.samples) {
    if (sample.metric !== executionMetric || sample.sessionId !== sessionId || !Number.isSafeInteger(sample.sequence) ||
        sample.sequence !== sequence + 1 || sample.sequence > batch.sequence) throw invalid('Execution sample belongs to a different launch or sequence');
    const numbers = ['startMs', 'endMs', 'durationMs', 'busyMs', 'occupancyPercent', 'managedMs', 'uiMs', 'debuggerMs'];
    if (numbers.some(key => !Number.isFinite(sample[key]) || sample[key] < 0) || sample.startMs < end || sample.durationMs <= 0 ||
        Math.abs(sample.endMs - sample.startMs - sample.durationMs) > 0.001 || sample.busyMs > sample.durationMs + 0.001 ||
        sample.occupancyPercent > 100 || Math.abs(sample.busyMs / sample.durationMs * 100 - sample.occupancyPercent) > 0.001 ||
        Math.abs(sample.managedMs + sample.uiMs + sample.debuggerMs - sample.busyMs) > 0.001) throw invalid('Invalid measured execution interval');
    if ((sequence >= start || start === after + 1 && after > 0) && Math.abs(sample.startMs - end) > 0.001) {
      throw invalid('Consecutive execution intervals must share their boundary');
    }
    sequence = sample.sequence;
    end = sample.endMs;
    observedBusy += sample.busyMs;
  }
  if (observedBusy > batch.totalBusyMs + 0.001) throw invalid('Execution intervals exceed the capture total');
  return batch;
}

/** Serial bounded polling; late results and cancellation cannot retarget a replacement AppSession launch. */
export class ExecutionCapture {
  constructor({sessions, model, intervalMs = 1000, requestLimit = 256, clock = () => performance.now(),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer), onError} = {}) {
    if (!sessions?.list || !model?.execution) throw new TypeError('Execution capture requires session and timeline services');
    if (!Number.isFinite(intervalMs) || intervalMs < 100 || intervalMs > 10_000) throw new RangeError('Invalid capture poll interval');
    if (!Number.isSafeInteger(requestLimit) || requestLimit < 1 || requestLimit > 2000) throw new RangeError('Invalid capture batch limit');
    Object.assign(this, {sessions, model, intervalMs, requestLimit, clock, setTimer, clearTimer, onError});
    this.cursors = new Map();
    this.timer = null;
    this.controller = null;
    this.running = false;
    this.paused = false;
    this.disposed = false;
  }

  start() {
    if (!this.remove) this.remove = this.sessions.subscribe?.(() => this.wake());
    this.wake();
  }

  wake(delay = 0) {
    if (this.disposed || this.paused || this.running || this.timer !== null) return;
    if (!this.sessions.list().some(session => {
      const cursor = this.cursors.get(session.id);
      return Number.isSafeInteger(session.runtimeSession) && session.runtimeSession > 0 && !session.disposed &&
        (!cursor || cursor.identity !== session.identity || !cursor.blocked && (!cursor.complete || session.live));
    })) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.poll().catch(error => {
        this.lastError = error;
        this.setPaused(true);
        this.onError?.(error);
      });
    }, delay);
  }

  async sample(session, signal) {
    const identity = session.identity, sessionId = session.runtimeSession;
    let cursor = this.cursors.get(session.id);
    if (!cursor || cursor.identity !== identity) {
      cursor = {identity, after: 0, endMs: 0, complete: false, blocked: false, retryAt: 0};
      this.cursors.set(session.id, cursor);
      this.model.bind(session);
    }
    if (cursor.blocked || cursor.complete && !session.live || cursor.retryAt > this.clock()) return;
    try {
      const batch = await cancellable(session.request('executionMetrics', {identity, after: cursor.after, limit: this.requestLimit},
        {signal, timeoutMs: 3000}), signal);
      signal.throwIfAborted();
      if (this.disposed || session.disposed || session.identity !== identity || session.runtimeSession !== sessionId) return;
      validateExecutionBatch(batch, {sessionId, after: cursor.after, limit: this.requestLimit, previousEnd: cursor.endMs});
      this.model.execution(session, batch);
      cursor.after = batch.samples.at(-1)?.sequence ?? cursor.after;
      cursor.endMs = batch.samples.at(-1)?.endMs ?? cursor.endMs;
      cursor.complete = !batch.active && cursor.after === batch.sequence;
      cursor.retryAt = 0;
    } catch (error) {
      if (signal.aborted || this.disposed || session.disposed || session.identity !== identity || error.code === 'SESSION_STALE') return;
      cursor.blocked = ['UNKNOWN_METHOD', 'PROFILE_RESULT'].includes(error.code);
      cursor.retryAt = this.clock() + this.intervalMs * 5;
      this.model.executionFailure(session, error);
    }
  }

  async poll() {
    if (this.running || this.disposed || this.paused) return;
    this.running = true;
    this.controller = new AbortController();
    try {
      const sessions = this.sessions.list();
      if (sessions.length > 64) throw new Error('Runtime session count exceeds the supported 64-session capture bound');
      for (const id of this.cursors.keys()) if (!sessions.some(session => session.id === id)) this.cursors.delete(id);
      for (const session of sessions) {
        if (this.controller.signal.aborted || this.disposed) break;
        if (!session.disposed && Number.isSafeInteger(session.runtimeSession) && session.runtimeSession > 0) {
          await this.sample(session, this.controller.signal);
        }
      }
    } finally {
      this.running = false;
      this.controller = null;
      this.wake(this.intervalMs);
    }
  }

  setPaused(value) {
    this.paused = !!value;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.controller?.abort();
    if (!this.paused) this.wake();
    if (!this.disposed) this.model.emit({type: 'capture-state', paused: this.paused});
  }

  dispose() {
    this.disposed = true;
    this.setPaused(true);
    this.remove?.();
    this.cursors.clear();
  }
}
