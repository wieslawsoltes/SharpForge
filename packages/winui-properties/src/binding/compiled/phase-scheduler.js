import {PropertyFault} from '../../property/values.js';

/** One app/container queue; a host frame service or explicit flush advances phases. */
export class BindingPhaseScheduler {
  constructor({requestFrame = null, cancelFrame = () => {}, maxPending = 100000, maxPerFrame = 256} = {}) {
    if (![maxPending, maxPerFrame].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000000)) {
      throw new RangeError('Invalid binding phase budgets');
    }
    if (requestFrame !== null && typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') {
      throw new TypeError('Binding frame services must be callable');
    }
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
    this.maxPending = maxPending;
    this.maxPerFrame = maxPerFrame;
    this.phases = new Map();
    this.entries = new Map();
    this.pending = 0;
    this.nextId = 1;
    this.currentPhase = -1;
    this.scheduled = false;
    this.flushing = false;
    this.frame = null;
    this.generation = 0;
    this.disposed = false;
  }

  enqueue(phase, callback) {
    if (this.disposed) throw new PropertyFault('ObjectDisposedException', 'Binding phases are disposed');
    if (!Number.isInteger(phase) || phase < 0 || phase > 1024 || phase < this.currentPhase || typeof callback !== 'function') {
      throw new PropertyFault('ArgumentException', 'Invalid or already completed binding phase');
    }
    if (this.pending >= this.maxPending || this.nextId >= Number.MAX_SAFE_INTEGER) {
      throw new PropertyFault('InvalidOperationException', 'Binding phase queue budget exceeded');
    }
    const entry = {id: this.nextId++, phase, callback};
    this.add(entry);
    try { this.schedule(); }
    catch (error) { this.remove(entry.id); throw error; }
    return () => this.remove(entry.id);
  }

  add(entry) {
    const entries = this.phases.get(entry.phase) ?? new Map();
    entries.set(entry.id, entry);
    this.phases.set(entry.phase, entries);
    this.entries.set(entry.id, entry);
    this.pending++;
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    const phase = this.phases.get(entry.phase);
    phase.delete(id);
    if (!phase.size) this.phases.delete(entry.phase);
    this.pending--;
    if (!this.pending && !this.flushing) this.currentPhase = -1;
  }

  schedule() {
    if (!this.requestFrame || this.scheduled || !this.pending || this.disposed) return;
    this.scheduled = true;
    const generation = this.generation;
    let requesting = true, synchronous = false;
    try {
      this.frame = this.requestFrame(() => {
        if (requesting) { synchronous = true; return; }
        if (generation !== this.generation || this.disposed) return;
        this.scheduled = false;
        this.frame = null;
        this.flushNextPhase();
      });
      if (synchronous) {
        this.cancelFrame(this.frame);
        throw new PropertyFault('InvalidOperationException', 'Binding frame services must schedule asynchronously');
      }
    } catch (error) { this.scheduled = false; this.frame = null; throw error; }
    finally { requesting = false; }
  }

  /** One ascending phase per frame, with stable insertion order and a bounded batch. */
  flushNextPhase() {
    if (this.disposed || !this.pending || this.flushing) return 0;
    let phase = Infinity;
    for (const key of this.phases.keys()) phase = Math.min(phase, key);
    this.currentPhase = phase;
    const batch = [...this.phases.get(phase).values()].slice(0, this.maxPerFrame);
    const errors = [];
    let count = 0;
    this.flushing = true;
    try {
      for (const entry of batch) {
        if (!this.entries.has(entry.id)) continue;
        this.remove(entry.id);
        try { entry.callback(phase); count++; } catch (error) { errors.push(error); }
      }
    } finally { this.flushing = false; }
    if (!this.pending) this.currentPhase = -1;
    this.schedule();
    if (errors.length) throw new AggregateError(errors, 'Binding phase callbacks failed');
    return count;
  }

  cancel() {
    this.generation++;
    try { if (this.scheduled) this.cancelFrame(this.frame); }
    finally {
      this.scheduled = false;
      this.frame = null;
      this.pending = 0;
      this.phases.clear();
      this.entries.clear();
      this.currentPhase = -1;
    }
  }

  snapshot() {
    return {version: 1, nextId: this.nextId, currentPhase: this.currentPhase, disposed: this.disposed,
      entries: [...this.entries.values()].map(entry => ({...entry}))};
  }

  /** Schedule saved callbacks for a later frame; restoring never invokes rendering work. */
  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > this.maxPending
      || !Number.isSafeInteger(snapshot.nextId) || snapshot.nextId < 1
      || !Number.isInteger(snapshot.currentPhase) || snapshot.currentPhase < -1 || snapshot.currentPhase > 1024
      || typeof snapshot.disposed !== 'boolean'
      || new Set(snapshot.entries.map(entry => entry.id)).size !== snapshot.entries.length
      || snapshot.entries.some(entry => !Number.isSafeInteger(entry.id) || entry.id < 1 || entry.id >= snapshot.nextId
        || typeof entry.callback !== 'function' || !Number.isInteger(entry.phase) || entry.phase < 0 || entry.phase > 1024
        || entry.phase < snapshot.currentPhase) || snapshot.disposed && snapshot.entries.length) {
      throw new TypeError('Invalid binding phase snapshot');
    }
    this.cancel();
    this.disposed = snapshot.disposed;
    this.currentPhase = snapshot.currentPhase;
    this.nextId = snapshot.nextId;
    for (const entry of snapshot.entries) this.add({...entry});
    this.schedule();
  }

  dispose() { this.cancel(); this.disposed = true; }
}
