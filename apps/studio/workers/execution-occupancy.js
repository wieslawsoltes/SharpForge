export const executionMetric = 'worker-execution-occupancy';
export const executionCategories = Object.freeze(['managed', 'ui', 'debugger']);

function profileError(code, message) {
  return Object.assign(new Error(message), {code});
}

/** Measured synchronous execution wall time / actual interval wall time; never OS/process CPU utilization. */
export class ExecutionOccupancy {
  constructor({clock = () => performance.now(), intervalMs = 250, limit = 2000} = {}) {
    if (!Number.isFinite(intervalMs) || intervalMs < 50 || intervalMs > 5000) throw new RangeError('Invalid occupancy sampling interval');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError('Invalid occupancy history limit');
    this.clock = clock;
    this.intervalMs = intervalMs;
    this.limit = limit;
    this.samples = new Array(limit);
    this.totals = new Float64Array(executionCategories.length);
    this.previous = new Float64Array(executionCategories.length);
    this.active = false;
    this.sessionId = null;
    this.sequence = 0;
    this.depth = 0;
    this.closeRequested = false;
    this.observed = -Infinity;
  }

  now() {
    const value = this.clock();
    if (!Number.isFinite(value) || value < this.observed) throw profileError('PROFILE_CLOCK', 'Execution profile clock must be finite and monotonic');
    this.observed = value;
    return value;
  }

  reset(sessionId) {
    if (!Number.isSafeInteger(sessionId) || sessionId < 1) throw new RangeError('A raw runtime session identity is required');
    if (this.depth) throw profileError('PROFILE_BUSY', 'Cannot replace an execution profile inside a measured operation');
    this.sessionId = sessionId;
    this.origin = this.now();
    this.lastSample = this.origin;
    this.sequence = 0;
    this.samples.fill(undefined);
    this.totals.fill(0);
    this.previous.fill(0);
    this.closeRequested = false;
    this.active = true;
  }

  /** Nested callbacks count once under the outer operation; exceptions retain their original identity. */
  measure(category, action) {
    const index = executionCategories.indexOf(category);
    if (index < 0 || typeof action !== 'function') throw new TypeError('Unknown execution profile category');
    if (!this.active) return action();
    if (this.depth) {
      this.depth++;
      try { return action(); } finally { this.depth--; }
    }
    const started = this.now();
    this.depth = 1;
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        throw profileError('PROFILE_ASYNC_OPERATION', 'Execution occupancy measures synchronous work, not asynchronous waiting');
      }
      return result;
    } finally {
      this.depth = 0;
      this.totals[index] += this.now() - started;
      if (this.closeRequested) this.close();
    }
  }

  sample({force = false} = {}) {
    if (!this.active || this.depth) return null;
    const now = this.now(), durationMs = now - this.lastSample;
    if (durationMs <= 0 || !force && durationMs < this.intervalMs) return null;
    const categories = {};
    let busyMs = 0;
    for (let index = 0; index < executionCategories.length; index++) {
      const duration = this.totals[index] - this.previous[index];
      categories[executionCategories[index] + 'Ms'] = duration;
      busyMs += duration;
      this.previous[index] = this.totals[index];
    }
    if (busyMs > durationMs + 0.001) throw profileError('PROFILE_INTERVAL', 'Measured execution exceeds its wall-clock interval');
    const sample = Object.freeze({metric: executionMetric, sessionId: this.sessionId, sequence: ++this.sequence,
      startMs: this.lastSample - this.origin, endMs: now - this.origin, durationMs, busyMs,
      occupancyPercent: Math.min(100, busyMs / durationMs * 100), ...categories});
    this.samples[(this.sequence - 1) % this.limit] = sample;
    this.lastSample = now;
    return sample;
  }

  /** Return a bounded sequence window. A stopped profile remains readable until the next committed launch. */
  read({after = 0, limit = this.limit} = {}) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > this.limit) {
      throw new RangeError('Invalid execution profile cursor or result limit');
    }
    this.sample();
    if (after > this.sequence) throw profileError('PROFILE_CURSOR_RANGE', 'Execution profile cursor belongs to a different or newer capture');
    const first = Math.max(1, this.sequence - this.limit + 1), start = Math.max(first, after + 1), samples = [];
    for (let sequence = start; sequence <= this.sequence && samples.length < limit; sequence++) {
      samples.push(this.samples[(sequence - 1) % this.limit]);
    }
    return {metric: executionMetric, sessionId: this.sessionId, intervalMs: this.intervalMs, active: this.active,
      sequence: this.sequence, firstSequence: first, truncated: first > after + 1,
      totalBusyMs: this.totals.reduce((sum, duration) => sum + duration, 0), samples};
  }

  close() {
    if (this.depth) {
      this.closeRequested = true;
      return;
    }
    this.closeRequested = false;
    this.sample({force: true});
    this.active = false;
  }
}
