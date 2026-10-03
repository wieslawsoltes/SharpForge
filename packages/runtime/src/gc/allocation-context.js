import {ManagedFault} from './fault.js';

/** A context amortizes nursery-budget checks without owning or hiding managed roots. */
export class AllocationContext {
  constructor(heap, {threadId = 0, budget = 16 * 1024} = {}) {
    if (!Number.isSafeInteger(budget) || budget < 1) throw new RangeError('Invalid allocation context budget');
    this.heap = heap;
    this.threadId = threadId;
    this.budget = budget;
    this.remaining = 0;
    this.bytes = 0n;
    this.refills = 0;
    this.closed = false;
  }

  /** Reserve logical bytes; collection occurs only on budget refill or actual heap pressure. */
  reserve(bytes, roots = []) {
    if (this.closed) throw new ManagedFault('ObjectDisposedException', 'Allocation context is closed');
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Invalid allocation size');
    if (bytes > this.remaining || this.heap.stats.liveBytes + bytes > this.heap.threshold) {
      this.heap.reserve(bytes, roots);
      this.remaining = Math.max(this.budget, bytes);
      this.refills++;
    }
    this.remaining -= bytes;
    this.bytes += BigInt(bytes);
  }

  allocate(kind, type, data, roots = [], options = {}) {
    if (this.closed) throw new ManagedFault('ObjectDisposedException', 'Allocation context is closed');
    return this.heap.allocate(kind, type, data, roots, {...options, allocationContext: this});
  }

  dispose() {
    this.remaining = 0;
    this.closed = true;
    this.heap.allocationContexts?.delete(this);
  }

  snapshot() {
    return {threadId: this.threadId, budget: this.budget, remaining: this.remaining,
      bytes: this.bytes, refills: this.refills, closed: this.closed};
  }

  restore(state) {
    this.remaining = state.remaining;
    this.bytes = state.bytes;
    this.refills = state.refills;
    this.closed = state.closed;
  }
}
