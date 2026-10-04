import {ManagedFault} from './fault.js';
import {gcBoolean, gcBytes, gcInteger} from './api-arguments.js';
import {captureGCMemoryInfo} from './memory-info.js';

export const GCLatencyMode = Object.freeze({Batch: 0, Interactive: 1, LowLatency: 2, SustainedLowLatency: 3, NoGCRegion: 4});
export const GCLargeObjectHeapCompactionMode = Object.freeze({Default: 1, CompactOnce: 2});

/** Per-heap latency policy, exact allocation accounting and no-GC-region state. */
export class GCSettings {
  constructor(heap, options = {}) {
    this.heap = heap;
    const config = options.gcConfiguration ?? options.gcConfig ?? options;
    this.concurrent = config.concurrent ?? true;
    this.isServerGC = false;
    this._latencyMode = this.concurrent ? GCLatencyMode.Interactive : GCLatencyMode.Batch;
    this._compactionMode = GCLargeObjectHeapCompactionMode.Default;
    this.noGCRegion = null;
    this.threadAllocatedBytes = new Map();
    this.memoryInfo = new Map();
    this.collectionBefore = null;
    this.clock = options.gcClock ?? (() => performance.now());
    this.startedAt = this.clock();
    this.conserveMemory = config.conserveMemory ?? 0;
  }

  get latencyMode() {
    return this.noGCRegion?.active ? GCLatencyMode.NoGCRegion : this._latencyMode;
  }

  set latencyMode(value) {
    gcInteger(value, 'LatencyMode', 0, 4);
    if (value === GCLatencyMode.NoGCRegion) {
      throw new ManagedFault('ArgumentException', 'Use TryStartNoGCRegion to enter NoGCRegion latency mode');
    }
    if (this.noGCRegion?.active) throw new ManagedFault('InvalidOperationException', 'A no-GC region is active');
    this._latencyMode = value;
  }

  get largeObjectHeapCompactionMode() {
    return this._compactionMode;
  }

  set largeObjectHeapCompactionMode(value) {
    this._compactionMode = gcInteger(value, 'LargeObjectHeapCompactionMode', 1, 2);
  }

  /** Incremental scheduling is cooperative, and never promises host-thread concurrency. */
  collectionPolicy() {
    const mode = this.latencyMode;
    return {
      incremental: this.concurrent && mode !== GCLatencyMode.Batch && mode !== GCLatencyMode.NoGCRegion,
      stepBudget: mode === GCLatencyMode.LowLatency ? 32 : mode === GCLatencyMode.SustainedLowLatency ? 64 : 128,
      allowFullBlocking: mode !== GCLatencyMode.LowLatency && mode !== GCLatencyMode.SustainedLowLatency,
      budgetScale: Math.max(0.1, 1 - this.conserveMemory / 10)
    };
  }

  /** Called before reserve: false suppresses collection while both region budgets hold. */
  shouldCollect(bytes, {space = 'small'} = {}) {
    const region = this.noGCRegion;
    if (!region?.active) return true;
    const size = gcBytes(bytes, 'allocationBytes', true);
    const large = space === 'large';
    const exceeds = region.used + size > region.totalSize ||
      large && region.lohSize !== null && region.lohUsed + size > region.lohSize ||
      !large && region.lohSize !== null && region.sohUsed + size > region.totalSize - region.lohSize;
    if (!exceeds) return false;
    this.breakRegion('The no-GC-region allocation budget was exceeded');
    return true;
  }

  onAllocation(bytes, {space = 'small', threadId = 0} = {}) {
    const size = gcBytes(bytes, 'allocationBytes', true);
    this.threadAllocatedBytes.set(threadId, (this.threadAllocatedBytes.get(threadId) ?? 0n) + size);
    const region = this.noGCRegion;
    if (!region?.active) return;
    region.used += size;
    if (space === 'large') region.lohUsed += size;
    else region.sohUsed += size;
    this.shouldCollect(0, {space});
  }

  /** Return false if the reservation cannot fit; a preliminary full collection is optional. */
  tryStartNoGCRegion(totalSize, lohSize = null, disallowFullBlockingGC = false) {
    totalSize = gcBytes(totalSize, 'totalSize');
    lohSize = lohSize === null ? null : gcBytes(lohSize, 'lohSize', true);
    disallowFullBlockingGC = gcBoolean(disallowFullBlockingGC, 'disallowFullBlockingGC');
    if (lohSize !== null && lohSize > totalSize) {
      throw new ManagedFault('ArgumentOutOfRangeException', 'lohSize exceeds totalSize');
    }
    if (this.noGCRegion) throw new ManagedFault('InvalidOperationException', 'A no-GC region has already been started');
    if (totalSize > BigInt(this.heap.maxBytes)) return false;
    if (this.heap.collector?.active) {
      if (disallowFullBlockingGC) return false;
      this.heap.collect([], {generation: 2, blocking: true, reason: 'NoGCRegionPreparation'});
    }
    if (BigInt(this.heap.maxBytes - this.heap.stats.liveBytes) < totalSize) {
      if (disallowFullBlockingGC) return false;
      this.heap.collect([], {generation: 2, blocking: true, reason: 'Induced'});
      if (BigInt(this.heap.maxBytes - this.heap.stats.liveBytes) < totalSize) return false;
    }
    this.noGCRegion = {active: true, totalSize, lohSize, used: 0n, lohUsed: 0n, sohUsed: 0n, failure: null};
    return true;
  }

  breakRegion(message) {
    if (!this.noGCRegion?.active) return;
    this.noGCRegion.active = false;
    this.noGCRegion.failure = message;
  }

  endNoGCRegion() {
    const region = this.noGCRegion;
    if (!region) throw new ManagedFault('InvalidOperationException', 'No no-GC region is in progress');
    this.noGCRegion = null;
    if (!region.active) throw new ManagedFault('InvalidOperationException', region.failure);
  }

  onCollectionStart(options = {}) {
    this.breakRegion('A collection occurred during the no-GC region');
    this.collectionBefore = {
      generationBytes: [...(this.heap.stats.generationBytes ?? [this.heap.stats.liveBytes, 0, 0])],
      spaces: this.heap.spaces?.memoryInfo?.() ?? null
    };
  }

  onCollectionComplete(stats = this.heap.stats, options = {}) {
    const info = captureGCMemoryInfo(this.heap, stats, options, this.collectionBefore, this.clock() - this.startedAt);
    const kind = options.blocking === false ? 3 : (options.generation ?? 2) === 2 ? 2 : 1;
    this.memoryInfo.set(0, info);
    this.memoryInfo.set(kind, info);
    this.collectionBefore = null;
    if ((options.generation ?? 2) === 2 && options.compacting) this._compactionMode = GCLargeObjectHeapCompactionMode.Default;
  }

  snapshot() {
    return {
      latencyMode: this._latencyMode, compactionMode: this._compactionMode, concurrent: this.concurrent,
      conserveMemory: this.conserveMemory, noGCRegion: this.noGCRegion ? {...this.noGCRegion} : null,
      threadAllocatedBytes: [...this.threadAllocatedBytes], memoryInfo: [...this.memoryInfo],
      collectionBefore: this.collectionBefore, elapsedMs: Math.max(0, this.clock() - this.startedAt)
    };
  }

  restore(state) {
    this._latencyMode = state.latencyMode;
    this._compactionMode = state.compactionMode;
    this.concurrent = state.concurrent;
    this.conserveMemory = state.conserveMemory;
    this.noGCRegion = state.noGCRegion ? {...state.noGCRegion} : null;
    this.threadAllocatedBytes = new Map(state.threadAllocatedBytes);
    this.memoryInfo = new Map(state.memoryInfo);
    this.collectionBefore = state.collectionBefore;
    this.startedAt = this.clock() - state.elapsedMs;
  }
}
