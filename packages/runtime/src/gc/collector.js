import { AllocationBlocks } from './blocks.js';
import { GenerationBudget } from './budget.js';
import { CardTable } from './card-table.js';
import { shouldCompactLarge } from './compact-api.js';
import { finishMark } from './finish-mark.js';
import { ManagedFault } from './fault.js';
import { generationAllocated, generationReleased, initializeGenerations, validateGeneration } from './generations.js';
import { IncrementalMarker } from './incremental-mark.js';
import { IncrementalSweep } from './incremental-sweep.js';
import { SurvivorPromotion } from './promotion.js';

function collectionRequest(options = {}, blocking = true) {
  return { ...options, generation: validateGeneration(options.generation ?? 2), reason: options.reason ?? 'Induced',
    blocking: options.blocking ?? blocking, compacting: options.compacting ?? false };
}

function validateBudget(budget) {
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10000000) {
    throw new RangeError('Collector work budget must be between 1 and 10000000');
  }
}

/** Precise full, generational and incremental collection share barriers, lifetime ordering and block sweep. */
export class Collector {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.generational = options.generational === true;
    this.incremental = options.incremental === true;
    this.allocationSliceBudget = options.allocationSliceBudget ?? 128;
    validateBudget(this.allocationSliceBudget);
    initializeGenerations(heap);
    this.budgets = new GenerationBudget(heap, options);
    this.blocks = new AllocationBlocks(heap, options);
    this.cards = new CardTable(heap, options);
    this.marker = new IncrementalMarker(heap, this.blocks, this.cards);
    this.cycle = null;
    this.sweep = null;
    this.promotion = null;
    this.lastResult = null;
    this.closed = false;
    this.callbacks = { isMarked: value => this.marker.isMarked(value), mark: value => this.marker.mark(value),
      drain: () => this.marker.drain() };
    this.allocationOwner = null;
    this.rememberAllocationEdge = value => this.cards.remember(this.allocationOwner, value);
  }

  get active() {
    return this.cycle !== null;
  }

  get phase() {
    return this.cycle?.phase ?? 'idle';
  }

  allocated(reference) {
    const record = this.heap.get(reference);
    generationAllocated(this.heap, record);
    this.budgets.allocatedBytes(record);
    this.blocks.allocated(reference);
    this.allocationOwner = reference;
    if (record.gcGeneration > 0) this.heap.visitEdges(record, this.rememberAllocationEdge);
    this.allocationOwner = null;
    if (this.active) this.marker.allocatedBlack(reference);
  }

  resized(reference, previousSize, { barrier = true } = {}) {
    const record = this.heap.get(reference);
    const delta = record.size - previousSize;
    const previousGeneration = this.blocks.slots[reference.h]?.generation ?? record.gcGeneration;
    if (previousGeneration !== record.gcGeneration) {
      this.heap.stats.generationCounts[previousGeneration]--;
      this.heap.stats.generationBytes[previousGeneration] -= previousSize;
      this.heap.stats.generationCounts[record.gcGeneration]++;
      this.heap.stats.generationBytes[record.gcGeneration] += record.size;
      this.blocks.promoted(reference, previousGeneration);
      this.budgets.promoted(record, previousGeneration);
    } else {
      this.heap.stats.generationBytes[record.gcGeneration] += delta;
      if (delta > 0) this.budgets.allocatedBytes(record, delta);
    }
    if (this.active) {
      const source = this.marker.resized(reference, previousSize);
      if (source >= 0 && this.cycle.phase !== 'mark') this.cycle.survivingBytes[source] += delta;
    }
    if (this.promotion?.cursor?.handle === reference.h) this.promotion.cursor.next = 0;
    if (barrier && record.descriptor.scan !== 'none') this.cards.dirty(reference);
    if (barrier && this.active && this.marker.isMarked(reference)) this.heap.visitEdges(record, this.marker.barrierVisit);
  }

  released(reference, record) {
    generationReleased(this.heap, record);
    this.cards.forget(reference);
    this.blocks.released(reference);
  }

  writeBarrier(ownerReference, newValue) {
    this.cards.remember(ownerReference, newValue);
    if (this.active) this.marker.insertionBarrier(ownerReference, newValue);
  }

  /** Publish an already performed bulk store with one card update and precise reference-range shading. */
  bulkWriteBarrier(ownerReference, start, count) {
    const record = this.heap.get(ownerReference);
    const descriptor = record.descriptor;
    if (descriptor.scan === 'none' || count === 0) return;
    this.cards.dirty(ownerReference);
    if (!this.active || !this.marker.isMarked(ownerReference)) return;
    if (descriptor.scan === 'all') {
      this.heap.visitEdgeRange(record, start, count, this.marker.barrierVisit);
      return;
    }
    const slots = descriptor.referenceSlots;
    let low = 0;
    let high = slots.length;
    while (low < high) {
      const middle = low + ((high - low) >> 1);
      if (slots[middle] < start) low = middle + 1;
      else high = middle;
    }
    const end = start + count;
    for (let index = low; index < slots.length && slots[index] < end; index++) this.marker.barrierVisit(record.data[slots[index]]);
  }

  rootBarrier(value) {
    if (this.active && this.marker.mark(value)) this.marker.statistics.barrierMarks++;
  }

  /** Dependent entries are conditional edges, including mutations after the weak/finalizer termination phase. */
  dependentBarrier(primary, secondary, owner = null) {
    if (!this.active || !this.marker.isMarked(primary) || owner && !this.marker.isMarked(owner)) return;
    this.marker.barrierVisit(secondary);
  }

  generationForAllocation(bytes) {
    if (this.generational) return this.budgets.generationForAllocation(bytes);
    return this.heap.stats.liveBytes + bytes > this.heap.threshold ? 2 : null;
  }

  /** Called once before publication. It drives lazy work and may request one collection; hard limits remain the allocator's job. */
  beforeAllocation(bytes, extraRoots = []) {
    const space = bytes >= (this.heap.spaces?.large?.threshold ?? 85000) ? 'large' : 'small';
    if (this.heap.settings?.shouldCollect?.(bytes, { space }) === false) return null;
    const roots = Array.isArray(extraRoots) ? extraRoots : [...extraRoots];
    if (this.active) {
      for (const value of roots) this.rootBarrier(value);
      this.step(this.allocationSliceBudget);
      if (this.active && this.heap.stats.liveBytes + bytes > this.heap.maxBytes) return this.heap.collect(roots);
      if (this.active) return null;
    }
    const generation = this.generationForAllocation(bytes);
    if (generation === null) return null;
    const options = { generation, reason: 'AllocationBudget', blocking: !this.incremental };
    if (!this.incremental) return this.heap.collect(roots, options);
    this.heap.collect(roots, options);
    this.step(this.allocationSliceBudget);
    return this.active ? null : this.lastResult;
  }

  startIncremental(options = {}) {
    if (this.active) throw new Error('A managed collection is already active');
    return this.heap.collect(options.extraRoots ?? [], { ...options, blocking: false });
  }

  start(extraRoots, request) {
    const started = performance.now();
    this.cycle = { phase: 'mark', request, extraRoots: Array.from(extraRoots), generation: request.generation,
      beforeBytes: [...this.heap.stats.generationBytes], survivingBytes: [0, 0, 0],
      cutoff: this.heap.generationCounter, started, pauseMs: 0, maxPauseMs: 0, markMs: 0, sweepMs: 0,
      promotionMs: 0, terminationMs: 0, escalated: false, work: 0, lifetime: {}, cards: {} };
    this.sweep = null;
    this.promotion = null;
    this.heap.settings?.onCollectionStart?.(request);
    this.heap.notifications?.beforeCollection?.(request);
    this.heap.events?.collectionStart?.({ ...request, index: this.heap.stats.collections + 1 });
    this.heap.noteMutation();
    this.seedMark(request.generation);
    this.recordPause(performance.now() - started, 'markMs');
    return this.status(0);
  }

  seedMark(generation) {
    this.marker.begin(generation);
    this.marker.roots(this.cycle.extraRoots);
    this.cycle.cards = generation < 2 ? this.cards.seed(generation, this.marker.rememberedVisit)
      : { cardsScanned: 0, ownersScanned: 0, rememberedEdgesScanned: 0 };
  }

  survivingBytes() {
    return [...this.marker.statistics.markedBytesByGeneration];
  }

  terminateMark() {
    const started = performance.now();
    this.marker.roots(this.cycle.extraRoots);
    this.marker.drain();
    const surviving = this.survivingBytes();
    if (this.budgets.promotionOverflows(this.cycle.generation, surviving)) {
      this.escalate();
      this.cycle.terminationMs += performance.now() - started;
      return;
    }
    const lifetime = finishMark(this.heap, this.marker, this.cycle.extraRoots, this.callbacks, { rescan: false });
    for (const [name, value] of Object.entries(lifetime)) this.cycle.lifetime[name] = (this.cycle.lifetime[name] ?? 0) + value;
    this.cycle.survivingBytes = this.survivingBytes();
    if (this.budgets.promotionOverflows(this.cycle.generation, this.cycle.survivingBytes)) {
      this.escalate();
      this.cycle.terminationMs += performance.now() - started;
      return;
    }
    this.heap.events?.mark?.({ generation: this.cycle.generation, ...this.marker.statistics });
    this.sweep = new IncrementalSweep(this.heap, this.blocks, this.marker);
    this.cycle.phase = 'sweep';
    this.cycle.terminationMs += performance.now() - started;
  }

  escalate() {
    this.cycle.generation = 2;
    this.cycle.request.generation = 2;
    this.cycle.escalated = true;
    this.heap.notifications?.beforeCollection?.(this.cycle.request);
    this.seedMark(2);
  }

  recordPause(duration, field = null) {
    this.cycle.pauseMs += duration;
    this.cycle.maxPauseMs = Math.max(this.cycle.maxPauseMs, duration);
    if (field) this.cycle[field] += duration;
  }

  /** Advance at most budget charged operations. Root termination and requested compaction are separately measured atomic phases. */
  step(budget = 128) {
    validateBudget(budget);
    if (this.closed || this.heap.closed) throw new ManagedFault('ObjectDisposedException', 'Managed collector is disposed');
    if (!this.active) return this.status(0);
    if (!this.heap.events.observersDeferred) {
      return this.heap.withRoots(this.cycle.extraRoots,
        () => this.heap.events.deferObservers(() => this.step(budget)));
    }
    if (this.heap.safepoints && !this.heap.safepoints.suspension) {
      return this.heap.safepoints.withSuspension(() => this.step(budget), this.cycle.request);
    }
    this.heap.safepoints?.assertStopped();
    const started = performance.now();
    let work = 0;
    if (this.marker.pending || this.cycle.phase === 'mark') {
      const phaseStarted = performance.now();
      if (this.marker.pending) work += this.marker.step(budget).work;
      if (!this.marker.pending && this.cycle.phase === 'mark') this.terminateMark();
      this.cycle.markMs += performance.now() - phaseStarted;
    }
    if (!this.marker.pending && this.cycle.phase === 'sweep' && !this.sweep.done && work < budget) {
      const phaseStarted = performance.now();
      work += this.sweep.step(budget - work).work;
      this.cycle.sweepMs += performance.now() - phaseStarted;
    }
    if (this.cycle.phase === 'promote' || this.cycle.phase === 'sweep' && this.sweep.done && !this.marker.pending) {
      const phaseStarted = performance.now();
      if (this.cycle.phase === 'sweep') {
        this.promotion = new SurvivorPromotion(this.heap, { blocks: this.blocks, cards: this.cards,
          marker: this.marker, budgets: this.budgets, cutoff: this.cycle.cutoff });
        this.cycle.phase = 'promote';
      }
      if (work < budget) work += this.promotion.step(budget - work).work;
      this.cycle.promotionMs += performance.now() - phaseStarted;
    }
    // Phases share one uninterrupted pause even when this step crosses their boundaries.
    // Completion observers run after this measurement; terminationMs remains a subset of markMs.
    this.recordPause(performance.now() - started);
    this.cycle.work += work;
    if (this.cycle.phase === 'promote' && this.promotion.done && !this.marker.pending) this.complete();
    return this.status(work);
  }

  /** Explicit collection blocks until the requested generations have completed reclamation and promotion. */
  collect(extraRoots = [], options = {}) {
    if (!this.heap.events.observersDeferred) return this.heap.collect(extraRoots, options);
    const request = collectionRequest(options);
    if (this.closed || this.heap.closed) throw new ManagedFault('ObjectDisposedException', 'Managed collector is disposed');
    if (this.heap.safepoints && !this.heap.safepoints.suspension) {
      return this.heap.safepoints.withSuspension(() => this.collect(extraRoots, request), request);
    }
    this.heap.safepoints?.assertStopped();
    const roots = Array.from(extraRoots);
    if (!request.blocking) {
      if (!this.active) return this.start(roots, request);
      this.retainAdditionalRoots(roots);
      if (this.cycle.generation < request.generation || request.compacting) this.cycle.followupRequest = request;
      return this.status(0);
    }
    if (this.active) {
      this.retainAdditionalRoots(roots);
      const insufficient = this.cycle.generation < request.generation;
      while (this.active) this.step(65536);
      if (!insufficient && !request.compacting) return this.lastResult;
    }
    this.start(roots, request);
    while (this.active) this.step(65536);
    return this.lastResult;
  }

  retainAdditionalRoots(roots) {
    for (const value of roots) {
      this.cycle.extraRoots.push(value);
      this.rootBarrier(value);
    }
  }

  complete() {
    const cycle = this.cycle;
    cycle.survivingBytes = this.survivingBytes();
    const stats = this.heap.stats;
    const request = cycle.request;
    const compactLarge = shouldCompactLarge(this.heap.settings, request);
    let compaction = null;
    if (cycle.generation === 2 && (request.compacting || compactLarge)) {
      const started = performance.now();
      compaction = this.heap.spaces?.compact?.({ generation: 2, includeLarge: compactLarge }) ?? null;
      this.recordPause(performance.now() - started, 'sweepMs');
    }
    stats.collections++;
    for (let index = 0; index <= cycle.generation; index++) stats.generationCollections[index]++;
    Object.assign(stats, this.marker.statistics, cycle.generation < 2 ? this.cards.statistics() : cycle.cards);
    stats.markMs = cycle.markMs;
    stats.sweepMs = cycle.sweepMs;
    stats.promotionMs = cycle.promotionMs;
    stats.lastPauseMs = request.blocking ? cycle.pauseMs : cycle.maxPauseMs;
    stats.totalPauseMs += cycle.pauseMs;
    stats.maxPauseMs = Math.max(stats.maxPauseMs, cycle.maxPauseMs, request.blocking ? cycle.pauseMs : 0);
    this.budgets.collectionCompleted(cycle.generation, cycle.beforeBytes, cycle.survivingBytes);
    this.lastResult = { ...stats, generationCounts: [...stats.generationCounts], generationBytes: [...stats.generationBytes],
      rootsScannedByCategory: { ...stats.rootsScannedByCategory },
      generationCollections: [...stats.generationCollections], generation: cycle.generation, reason: request.reason,
      generationBytesBefore: [...cycle.beforeBytes], generationBytesAfter: [...stats.generationBytes],
      freedThisCollection: this.sweep.statistics.freedObjects, bytesThisCollection: this.sweep.statistics.freedBytes,
      sweepBlocks: this.sweep.statistics.blocksVisited, sweepSlots: this.sweep.statistics.slotsVisited,
      promotedObjects: this.promotion.promotedObjects, promotedBytes: this.promotion.promotedBytes,
      collectionPauseMs: cycle.pauseMs, terminationMs: cycle.terminationMs, escalated: cycle.escalated,
      lifetime: { ...cycle.lifetime }, compaction };
    this.heap.retainObserverRoots(cycle.extraRoots);
    this.cycle = null;
    this.heap.settings?.onCollectionComplete?.(this.lastResult, request);
    this.heap.notifications?.afterCollection?.(this.lastResult, request);
    this.heap.events?.collectionEnd?.(this.lastResult, request);
    if (cycle.followupRequest) this.start(cycle.extraRoots, cycle.followupRequest);
  }

  status(work) {
    return { phase: this.phase, state: this.phase, active: this.active, done: !this.active, work,
      generation: this.cycle?.generation ?? this.lastResult?.generation ?? 2, result: this.active ? null : this.lastResult };
  }

  /** Teardown discards in-flight work; the owning heap subsequently reclaims every record. */
  dispose() {
    this.cycle = null;
    this.sweep = null;
    this.promotion = null;
    this.marker.work.length = 0;
    this.marker.survivors.length = 0;
    this.marker.cursor = null;
    this.cards.cards.clear();
    this.cards.revisions.clear();
    this.closed = true;
  }

  snapshot() {
    return { version: 1, budgets: this.budgets.snapshot(), blocks: this.blocks.snapshot(), cards: this.cards.snapshot(),
      marker: this.marker.snapshot(), cycle: this.cycle ? { ...this.cycle, request: { ...this.cycle.request },
        extraRoots: [...this.cycle.extraRoots], beforeBytes: [...this.cycle.beforeBytes],
        survivingBytes: [...this.cycle.survivingBytes], lifetime: { ...this.cycle.lifetime }, cards: { ...this.cycle.cards } } : null,
      sweep: this.sweep?.snapshot() ?? null, promotion: this.promotion?.snapshot() ?? null, lastResult: this.lastResult };
  }

  restore(state) {
    this.budgets.restore(state?.budgets);
    this.blocks.restore(state?.blocks);
    this.cards.restore(state?.cards);
    this.marker.restore(state?.marker);
    this.cycle = state?.cycle ? { ...state.cycle, request: { ...state.cycle.request }, extraRoots: [...state.cycle.extraRoots],
      beforeBytes: [...state.cycle.beforeBytes], survivingBytes: [...state.cycle.survivingBytes],
      lifetime: { ...state.cycle.lifetime }, cards: { ...state.cycle.cards } } : null;
    this.sweep = state?.sweep ? new IncrementalSweep(this.heap, this.blocks, this.marker, state.sweep) : null;
    this.promotion = state?.promotion && this.cycle ? new SurvivorPromotion(this.heap, { blocks: this.blocks, cards: this.cards,
      marker: this.marker, budgets: this.budgets, cutoff: this.cycle.cutoff, state: state.promotion }) : null;
    this.lastResult = state?.lastResult ?? null;
  }
}
