import {gcInteger} from './api-arguments.js';
import {generationSizes} from './memory-info.js';

/** A disposable fixed-interval publisher; bytes/sec and pause percentages use elapsed milliseconds. */
export class GCCounters {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.intervalMs = gcInteger(options.intervalMs ?? 1000, 'intervalMs', 1);
    this.clock = options.gcClock ?? heap.settings?.clock ?? (() => performance.now());
    this.setInterval = options.setInterval ?? globalThis.setInterval;
    this.clearInterval = options.clearInterval ?? globalThis.clearInterval;
    this.startedAt = heap.settings?.startedAt ?? this.clock();
    this.lastAt = this.clock();
    this.lastAllocated = heap.stats.allocatedBytes;
    this.lastPauseMs = heap.stats.totalPauseMs ?? 0;
    this.listeners = new Set();
    this.disposers = new Set();
    this.timer = null;
    this.disposed = false;
    this.observerErrors = [];
  }

  sample() {
    const now = this.clock();
    const elapsed = Math.max(0, now - this.startedAt);
    const interval = Math.max(0, now - this.lastAt);
    const stats = this.heap.stats;
    const spaces = this.heap.spaces?.memoryInfo?.() ?? {};
    const sizes = generationSizes(stats, spaces);
    const counts = stats.generationCollections ?? [stats.collections, stats.collections, stats.collections];
    const totalPauseMs = stats.totalPauseMs ?? 0;
    const allocated = stats.allocatedBytes;
    const sample = Object.freeze({
      timestamp: now, elapsedMs: elapsed, intervalMs: interval,
      gen0Size: sizes[0], gen1Size: sizes[1], gen2Size: sizes[2], lohSize: sizes[3], pohSize: sizes[4],
      gen0Count: counts[0], gen1Count: counts[1], gen2Count: counts[2],
      heapSize: stats.liveBytes, allocationRate: interval > 0 ? Math.max(0, allocated - this.lastAllocated) * 1000 / interval : 0,
      totalAllocatedBytes: allocated, timeInGCPercent: elapsed > 0 ? totalPauseMs * 100 / elapsed : 0,
      intervalTimeInGCPercent: interval > 0 ? Math.max(0, totalPauseMs - this.lastPauseMs) * 100 / interval : 0,
      fragmentationBytes: spaces.fragmentedBytes ?? 0,
      fragmentationPercent: spaces.reservedBytes ? (spaces.fragmentedBytes ?? 0) * 100 / spaces.reservedBytes : 0,
      committedBytes: spaces.reservedBytes ?? stats.liveBytes,
      memoryPressureBytes: Number(this.heap.pressure?.bytes ?? 0n), totalPauseMs
    });
    this.lastAt = now;
    this.lastAllocated = allocated;
    this.lastPauseMs = totalPauseMs;
    return sample;
  }

  publish() {
    if (this.disposed) return;
    const sample = this.sample();
    for (const listener of this.listeners) {
      try {
        listener(sample);
      } catch (error) {
        if (this.observerErrors.length === 32) this.observerErrors.shift();
        this.observerErrors.push(Object.freeze({id: 'SF-GC-COUNTER-001', message: String(error?.message ?? error).slice(0, 512)}));
      }
    }
    return sample;
  }

  subscribe(listener, {signal, emitInitial = true} = {}) {
    if (this.disposed) throw new Error('GC counter publisher is disposed');
    if (typeof listener !== 'function') throw new TypeError('GC counter listener must be a function');
    if (this.listeners.size >= 1024) throw new RangeError('GC counter listener limit exceeded');
    const subscribed = sample => listener(sample);
    const dispose = () => {
      this.listeners.delete(subscribed);
      this.disposers.delete(dispose);
      signal?.removeEventListener('abort', dispose);
      if (!this.listeners.size && this.timer !== null) {
        this.clearInterval(this.timer);
        this.timer = null;
      }
    };
    if (!signal?.aborted) {
      this.listeners.add(subscribed);
      this.disposers.add(dispose);
      signal?.addEventListener('abort', dispose, {once: true});
      if (this.timer === null) {
        this.timer = this.setInterval(() => this.publish(), this.intervalMs);
        this.timer?.unref?.();
      }
      if (emitInitial) {
        try {
          listener(this.sample());
        } catch (error) {
          dispose();
          throw error;
        }
      }
    }
    return Object.freeze({dispose});
  }

  dispose() {
    for (const dispose of [...this.disposers]) dispose();
    this.disposed = true;
  }

  /** Host subscriptions remain outside replay; sampling baselines and elapsed time are restored. */
  snapshot() {
    const now = this.clock();
    return {startedAt: this.startedAt, lastAt: this.lastAt, lastAllocated: this.lastAllocated,
      lastPauseMs: this.lastPauseMs, elapsedMs: now - this.startedAt, lastSampleAgeMs: now - this.lastAt,
      disposed: this.disposed, observerErrors: [...this.observerErrors]};
  }

  restore(state) {
    if (state.disposed !== this.disposed) throw new Error('A counter snapshot cannot cross publisher disposal');
    const now = this.clock();
    this.startedAt = now - state.elapsedMs;
    this.lastAt = now - state.lastSampleAgeMs;
    this.lastAllocated = state.lastAllocated;
    this.lastPauseMs = state.lastPauseMs;
    this.observerErrors = [...state.observerErrors];
  }
}
