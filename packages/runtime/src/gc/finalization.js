import {FinalizerContext} from './finalizer-context.js';
import {liveReference, sameReference, noteLifetimeMutation, lifetimeFault, positiveBudget} from './lifetime-state.js';

export const FinalizerState = Object.freeze({
  Registered: 'registered', Queued: 'queued', Running: 'running', Suppressed: 'suppressed', Finalized: 'finalized'
});

/** Registration is weak; queued/running finalization is an explicit f-reachable root. */
export class ManagedFinalizationRegistry {
  constructor(lifetime, options = {}) {
    this.lifetime = lifetime;
    this.heap = lifetime.heap;
    this.entries = new Map();
    this.normal = [];
    this.critical = [];
    this.normalHead = 0;
    this.criticalHead = 0;
    this.nextOrder = 1;
    this.queuedCount = 0;
    this.context = new FinalizerContext(this, options);
  }

  get pendingCount() {
    return this.queuedCount + (this.context.active ? 1 : 0);
  }

  requireEntry(reference) {
    const entry = this.entries.get(reference.h);
    if (!entry || !sameReference(entry.reference, reference)) throw lifetimeFault('The object has no finalizer registration');
    return entry;
  }

  register(reference, callback, {critical = false} = {}) {
    this.heap.get(reference);
    if (typeof callback !== 'function' && (callback === null || typeof callback !== 'object')) {
      throw new TypeError('A finalizer callback or managed method descriptor is required');
    }
    const previous = this.entries.get(reference.h);
    if (previous && sameReference(previous.reference, reference)) {
      previous.callback = callback;
      previous.critical = !!critical;
      this.reRegister(reference);
      return previous;
    }
    const entry = {reference, callback, critical: !!critical, order: this.nextOrder++,
      state: FinalizerState.Registered, reregister: false, queuedCritical: false};
    this.entries.set(reference.h, entry);
    this.heap.collector?.rootBarrier(reference);
    noteLifetimeMutation(this.heap);
    return entry;
  }

  suppress(reference) {
    this.heap.get(reference);
    const entry = this.entries.get(reference.h);
    if (!entry || !sameReference(entry.reference, reference)) return false;
    entry.reregister = false;
    if (entry.state === FinalizerState.Queued) this.queuedCount--;
    if (entry.state !== FinalizerState.Running) entry.state = FinalizerState.Suppressed;
    this.clearEmptyQueues();
    noteLifetimeMutation(this.heap);
    return true;
  }

  reRegister(reference) {
    this.heap.get(reference);
    const entry = this.entries.get(reference.h);
    if (!entry || !sameReference(entry.reference, reference)) return false;
    if (entry.state === FinalizerState.Running) entry.reregister = true;
    else if (entry.state !== FinalizerState.Queued) entry.state = FinalizerState.Registered;
    this.heap.collector?.rootBarrier(reference);
    noteLifetimeMutation(this.heap);
    return true;
  }

  /** Discover every candidate before tracing any, preserving normal-before-critical ordering. */
  discover({isMarked, mark, drain}) {
    let queued = 0;
    for (const entry of this.entries.values()) {
      if (entry.state !== FinalizerState.Registered || isMarked(entry.reference)) continue;
      entry.state = FinalizerState.Queued;
      entry.queuedCritical = entry.critical;
      (entry.critical ? this.critical : this.normal).push(entry.reference);
      queued++;
      this.queuedCount++;
    }
    for (const entry of this.entries.values()) if (entry.state === FinalizerState.Queued) mark(entry.reference);
    drain();
    return queued;
  }

  nextFrom(queue, headName) {
    while (this[headName] < queue.length) {
      const reference = queue[this[headName]++];
      const entry = this.entries.get(reference.h);
      if (entry && sameReference(entry.reference, reference) && entry.state === FinalizerState.Queued) {
        entry.state = FinalizerState.Running;
        this.queuedCount--;
        return entry;
      }
    }
    queue.length = 0;
    this[headName] = 0;
    return null;
  }

  dequeue() {
    return this.nextFrom(this.normal, 'normalHead') ?? this.nextFrom(this.critical, 'criticalHead');
  }

  complete(entry) {
    this.lifetime.completeFinalizer(entry.reference);
    entry.state = entry.reregister ? FinalizerState.Registered : FinalizerState.Finalized;
    entry.reregister = false;
    this.clearEmptyQueues();
    noteLifetimeMutation(this.heap);
  }

  clearEmptyQueues() {
    if (this.queuedCount !== 0) return;
    this.normal.length = 0;
    this.critical.length = 0;
    this.normalHead = 0;
    this.criticalHead = 0;
  }

  visitRoots(visitor) {
    for (const entry of this.entries.values()) if (entry.state === FinalizerState.Queued) {
      visitor(entry.reference, 'finalizer', entry.queuedCritical ? 'Critical f-reachable queue' : 'F-reachable queue');
    }
    this.context.visitRoots(visitor);
  }

  drain(options = {}) { return this.context.runSlice(options); }

  wait({budget = 1000000, maxInstructionsPerFinalizer = this.context.instructionLimit} = {}) {
    positiveBudget(budget, 'Finalizer wait budget');
    if (this.context.executing) return this.context.result(0, 0);
    const result = this.context.runSlice({budget, maxInstructionsPerFinalizer});
    if (result.fault) throw result.fault;
    if (result.pending) throw lifetimeFault('WaitForPendingFinalizers exhausted its bounded host wait budget');
    return result;
  }

  onReclaim(reference) {
    const entry = this.entries.get(reference.h);
    if (entry && sameReference(entry.reference, reference)) this.entries.delete(reference.h);
  }

  shutdown() {
    const discarded = this.pendingCount;
    this.context.stop();
    this.normal.length = 0;
    this.critical.length = 0;
    this.normalHead = 0;
    this.criticalHead = 0;
    this.queuedCount = 0;
    this.entries.clear();
    return discarded;
  }

  report() {
    return [...this.entries.values()].filter(entry => liveReference(this.heap, entry.reference)).map(entry => ({
      reference: entry.reference, state: entry.state, critical: entry.critical, order: entry.order
    }));
  }

  snapshot() {
    return {entries: [...this.entries].map(([id, entry]) => [id, {...entry}]), normal: [...this.normal], critical: [...this.critical],
      normalHead: this.normalHead, criticalHead: this.criticalHead, queuedCount: this.queuedCount,
      nextOrder: this.nextOrder, context: this.context.snapshot()};
  }

  restore(state) {
    this.entries = new Map(state.entries.map(([id, entry]) => [id, {...entry}]));
    this.normal = [...state.normal];
    this.critical = [...state.critical];
    this.normalHead = state.normalHead;
    this.criticalHead = state.criticalHead;
    this.queuedCount = state.queuedCount;
    this.nextOrder = Math.max(this.nextOrder, state.nextOrder);
    this.context.restore(state.context);
  }
}
