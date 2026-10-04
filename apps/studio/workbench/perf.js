/** Bounded per-session traces; disabled instruments take one branch and allocate nothing. */
export class WorkbenchPerformance {
  constructor({clock = () => performance.now(), limit = 4096, enabled = true} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new RangeError('Invalid performance trace limit');
    this.clock = clock;
    this.limit = limit;
    this.enabled = enabled;
    this.samples = [];
    this.offset = 0;
    this.seen = new Map();
  }
  start(name, sessionId = 'workbench') {
    if (!this.enabled) return null;
    let names = this.seen.get(sessionId);
    if (!names) {
      if (this.seen.size >= this.limit) this.seen.delete(this.seen.keys().next().value);
      this.seen.set(sessionId, names = new Set());
    }
    const cold = !names.has(name);
    names.add(name);
    return {name, sessionId, start: this.clock(), cold};
  }
  end(mark, metadata) {
    if (!mark) return;
    const duration = this.clock() - mark.start;
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Invalid performance clock');
    const sample = {...mark, duration, metadata};
    if (this.samples.length < this.limit) this.samples.push(sample);
    else { this.samples[this.offset] = sample; this.offset = (this.offset + 1) % this.limit; }
    return sample;
  }
  record(name, duration, sessionId = 'workbench') {
    if (!this.enabled) return;
    return this.end({name, sessionId, start: this.clock() - duration, cold: false});
  }
  summary() {
    const groups = new Map();
    for (const sample of this.samples) {
      const key = sample.sessionId + '\0' + sample.name;
      const group = groups.get(key) ?? {name: sample.name, sessionId: sample.sessionId, values: [], cold: []};
      group.values.push(sample.duration);
      if (sample.cold) group.cold.push(sample.duration);
      groups.set(key, group);
    }
    return [...groups.values()].map(group => {
      group.values.sort((left, right) => left - right);
      const percentile = percent => group.values[Math.max(0, Math.ceil(group.values.length * percent) - 1)];
      return {name: group.name, sessionId: group.sessionId, count: group.values.length,
        p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), cold: group.cold};
    });
  }
  checkBudgets(budgets, baseline = []) {
    const failures = [];
    for (const metric of this.summary()) {
      const previous = baseline.find(item => item.name === metric.name && item.sessionId === metric.sessionId);
      const absolute = budgets[metric.name];
      const limit = previous ? Math.min(absolute ?? Infinity, previous.p95 * 1.2) : absolute;
      if (limit !== undefined && metric.p95 > limit) failures.push({...metric, limit});
    }
    return failures;
  }
  export() {
    return JSON.stringify({format: 'sharpforge-workbench-trace', version: 1, units: 'milliseconds',
      summary: this.summary(), samples: this.samples}, null, 2);
  }
  observeInput(target, session = () => 'workbench') {
    const handler = event => {
      if (!this.enabled || !Number.isFinite(event.timeStamp)) return;
      this.record('input-delay', Math.max(0, this.clock() - event.timeStamp), session());
    };
    target.addEventListener('keydown', handler, {capture: true});
    target.addEventListener('pointerdown', handler, {capture: true});
    return () => {
      target.removeEventListener('keydown', handler, {capture: true});
      target.removeEventListener('pointerdown', handler, {capture: true});
    };
  }
}
