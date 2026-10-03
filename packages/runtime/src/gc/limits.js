import {ManagedFault} from './fault.js';

function positiveInteger(value, name) {
  if (typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value)) value = Number(value);
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

/** Explicit configuration avoids guessing a process/browser's available native memory. */
export function resolveHeapHardLimit(options = {}, fallbackBytes = 32 * 1024 * 1024) {
  const configuration = options.config ?? {};
  const bytes = options.heapHardLimitBytes ?? options.GCHeapHardLimit ?? options.hardLimitBytes ?? configuration.heapHardLimitBytes;
  const percent = options.heapHardLimitPercent ?? options.GCHeapHardLimitPercent ?? options.hardLimitPercent ?? configuration.heapHardLimitPercent;
  let percentage = null;
  if (percent !== undefined) {
    percentage = positiveInteger(percent, 'Managed heap hard-limit percent');
    if (percentage > 100) throw new RangeError('Managed heap hard-limit percent must not exceed 100');
  }
  if (bytes !== undefined) return positiveInteger(bytes, 'Managed heap hard limit');
  if (percentage === null) return positiveInteger(options.maxBytes ?? fallbackBytes, 'Managed heap hard limit');
  const total = positiveInteger(options.memoryLimitBytes ?? configuration.memoryLimitBytes, 'Explicit memory limit');
  const limit = Number(BigInt(total) * BigInt(percentage) / 100n);
  if (limit < 1) throw new RangeError('Managed heap hard limit rounds below one byte');
  return limit;
}

function replayable(roots) {
  return Array.isArray(roots) ? roots : [...roots];
}

function isAllocationFailure(error) {
  if (error?.name === 'OutOfMemoryException') return true;
  return error instanceof RangeError && /array buffer allocation failed|invalid (?:typed )?array length|out of memory|allocation failed/i.test(error.message);
}

/** Allocation preflight and one full compacting recovery; failures never publish a partial object. */
export class HeapLimits {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.limit = resolveHeapHardLimit(options, heap.maxBytes);
    this.recovering = false;
    this.recoveryCollections = 0;
    this.failures = 0;
    heap.maxBytes = this.limit;
    heap.threshold = Math.min(heap.threshold, this.limit);
  }

  _recover(roots) {
    if (this.recovering) throw new ManagedFault('OutOfMemoryException', 'Recursive managed allocation during memory recovery');
    this.recovering = true;
    try {
      this.heap.collect(roots, {generation: 2, reason: 'OutOfMemory', blocking: true, compacting: true});
      this.recoveryCollections++;
    } finally {
      this.recovering = false;
    }
  }

  _fail(message) {
    this.failures++;
    this.heap.stats.oomCount = (this.heap.stats.oomCount ?? 0) + 1;
    throw new ManagedFault('OutOfMemoryException', message);
  }

  reserve(bytes, roots = []) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) this._fail('Managed allocation size is outside the supported range');
    const retained = replayable(roots);
    if (this.heap.collector?.beforeAllocation) this.heap.collector.beforeAllocation(bytes, retained);
    else if (this.heap.stats.liveBytes + bytes > this.heap.threshold) this.heap.collect(retained);
    if (bytes <= this.limit && this.heap.stats.liveBytes <= this.limit - bytes) return;
    this._recover(retained);
    if (bytes > this.limit || this.heap.stats.liveBytes > this.limit - bytes) this._fail('Managed heap hard limit exhausted');
  }

  /** Retry arena/native allocation once. Unexpected exceptions remain their original errors. */
  allocationFailureRetry(action, roots = []) {
    const retained = replayable(roots);
    try {
      return action();
    } catch (error) {
      if (!isAllocationFailure(error)) throw error;
    }
    this._recover(retained);
    try {
      return action();
    } catch (error) {
      if (!isAllocationFailure(error)) throw error;
      this._fail('Managed backing-store allocation failed after a full compacting collection');
    }
  }

  snapshot() {
    return {limit: this.limit, recoveryCollections: this.recoveryCollections, failures: this.failures};
  }

  restore(state) {
    if (this.recovering) throw new ManagedFault('InvalidOperationException', 'Cannot restore during memory recovery');
    this.limit = positiveInteger(state.limit, 'Managed heap hard limit');
    this.heap.maxBytes = this.limit;
    this.recoveryCollections = state.recoveryCollections;
    this.failures = state.failures;
  }
}
