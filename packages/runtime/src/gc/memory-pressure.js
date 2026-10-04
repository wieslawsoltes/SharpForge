import {ManagedFault} from './fault.js';
import {gcBytes} from './api-arguments.js';

/** Host-resource pressure is separate from managed live-byte accounting. */
export class MemoryPressure {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.budget = gcBytes(options.memoryPressureBudget ?? Math.max(1, Math.floor(heap.maxBytes / 4)), 'memoryPressureBudget');
    this.bytes = 0n;
    this.addedBytes = 0n;
    this.removedBytes = 0n;
    this.nextCollectionAt = this.budget;
    this.collecting = false;
  }

  /** Add positive Int64 pressure, triggering one full collection when a budget is crossed. */
  add(value) {
    const bytes = gcBytes(value, 'bytesAllocated');
    this.bytes += bytes;
    this.addedBytes += bytes;
    this.heap.stats.memoryPressureBytes = Number(this.bytes);
    if (this.bytes < this.nextCollectionAt || this.collecting) return;
    this.collecting = true;
    this.nextCollectionAt = this.bytes + this.budget;
    try {
      this.heap.collect([], {generation: 2, reason: 'LowMemory', blocking: true});
    } finally {
      this.collecting = false;
    }
  }

  /** Reject an unmatched removal without mutating pressure or collection thresholds. */
  remove(value) {
    const bytes = gcBytes(value, 'bytesAllocated');
    if (bytes > this.bytes) throw new ManagedFault('ArgumentOutOfRangeException', 'Removed pressure exceeds outstanding pressure');
    this.bytes -= bytes;
    this.removedBytes += bytes;
    this.nextCollectionAt = this.bytes + this.budget;
    this.heap.stats.memoryPressureBytes = Number(this.bytes);
  }

  /** Associate pressure with an explicit disposable host-resource lease. */
  lease(bytes) {
    bytes = gcBytes(bytes, 'bytesAllocated');
    try {
      this.add(bytes);
    } catch (error) {
      // A failed induced collection must not leave an unreachable resource lease charged.
      this.remove(bytes);
      throw error;
    }
    let disposed = false;
    return Object.freeze({
      get disposed() { return disposed; },
      dispose: () => {
        if (disposed) return;
        this.remove(bytes);
        disposed = true;
      }
    });
  }

  snapshot() {
    return {budget: this.budget, bytes: this.bytes, addedBytes: this.addedBytes,
      removedBytes: this.removedBytes, nextCollectionAt: this.nextCollectionAt};
  }

  restore(state) {
    this.budget = state.budget;
    this.bytes = state.bytes;
    this.addedBytes = state.addedBytes;
    this.removedBytes = state.removedBytes;
    this.nextCollectionAt = state.nextCollectionAt;
    this.heap.stats.memoryPressureBytes = Number(this.bytes);
    this.collecting = false;
  }
}
