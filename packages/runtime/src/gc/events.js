import {gcInteger} from './api-arguments.js';
import {generationSizes} from './memory-info.js';
import {ManagedFault} from './fault.js';

const observerQueueLimit = 4096;

export const GCReason = Object.freeze({AllocSmall: 0, Induced: 1, LowMemory: 2, AllocLarge: 4,
  OutOfSpaceSOH: 5, OutOfSpaceLOH: 6, InducedNotForced: 7, Internal: 8, InducedCompacting: 10});
export const GCEventNames = Object.freeze([
  'GCTriggered', 'GCSuspendEEBegin', 'GCSuspendEEEnd', 'GCStart_V2', 'GCMarkWithType', 'GCHeapStats_V2',
  'GCEnd_V1', 'GCRestartEEBegin', 'GCRestartEEEnd', 'GCAllocationTick_V4', 'GCFinalizersBegin',
  'GCFinalizersEnd', 'GCCreateSegment', 'GCFreeSegment', 'PinObjectAtGCTime'
]);

/** Bounded ETW-shaped events. Timestamps are milliseconds from an injectable monotonic clock. */
export class GCEvents {
  constructor(options = {}) {
    this.capacity = gcInteger(options.gcEventCapacity ?? 2048, 'gcEventCapacity', 0, 1048576);
    this.buffer = new Array(this.capacity);
    this.start = 0;
    this.length = 0;
    this.sequence = 0;
    this.dropped = 0;
    this.clock = options.gcClock ?? (() => performance.now());
    this.sink = options.onGCEvent ?? options.runtimeEvents?.emit?.bind(options.runtimeEvents) ?? null;
    this.listeners = new Set();
    this.disposers = new Set();
    this.allocationTickBytes = gcInteger(options.gcAllocationTickBytes ?? 102400, 'gcAllocationTickBytes', 1);
    this.allocatedSinceTick = 0;
    this.observerErrors = [];
    this.activeCollection = null;
    this.observerDepth = 0;
    this.deliveringObservers = false;
    this.pendingObservers = [];
    this.observerLeases = [];
  }

  emit(name, payload = {}) {
    if (!GCEventNames.includes(name)) throw new TypeError(`Unknown GC event ${name}`);
    const event = Object.freeze({...payload, provider: 'Microsoft-Windows-DotNETRuntime', name,
      sequence: ++this.sequence, timestamp: this.clock()});
    if (this.capacity > 0) {
      const index = (this.start + this.length) % this.capacity;
      this.buffer[index] = event;
      if (this.length < this.capacity) this.length++;
      else {
        this.start = (this.start + 1) % this.capacity;
        this.dropped++;
      }
    } else this.dropped++;
    if (this.hasObservers) {
      if (this.pendingObservers.length < observerQueueLimit) this.pendingObservers.push(event);
      else this.observerError('SF-GC-EVENT-002', 'Deferred GC observer queue limit exceeded');
      if (!this.observersDeferred && !this.deliveringObservers) this.flushObservers();
    }
    return event;
  }

  get observersDeferred() { return this.observerDepth > 0; }
  get hasObservers() { return !!this.sink || this.listeners.size > 0; }

  /** Record events immediately; call observers after a complete collector operation. */
  deferObservers(action) {
    this.observerDepth++;
    try {
      return action();
    } finally {
      this.observerDepth--;
      if (!this.observersDeferred && !this.deliveringObservers) this.flushObservers();
    }
  }

  flushObservers() {
    this.deliveringObservers = true;
    try {
      // Nested collections append to the same bounded queue instead of recursing
      // into an unfinished mark phase or overtaking the original end events.
      for (let index = 0; index < this.pendingObservers.length; index++) {
        this.notifyObservers(this.pendingObservers[index]);
      }
    } finally {
      this.pendingObservers.length = 0;
      this.deliveringObservers = false;
      this.releaseObserverLeases();
    }
  }

  notifyObservers(event) {
    // New subscriptions start with the next event; disposal suppresses pending
    // callbacks. Re-subscribing cannot extend this event's iteration forever.
    const listeners = this.listeners.size ? [...this.listeners] : null;
    if (this.sink) this.deliver(this.sink, event);
    if (listeners) for (const listener of listeners) if (this.listeners.has(listener)) this.deliver(listener, event);
  }

  /** Release an existing root lease after the current observer queue drains. */
  releaseAfterObservers(lease) {
    if (this.observersDeferred || this.deliveringObservers) this.observerLeases.push(lease);
    else lease.dispose();
  }

  releaseObserverLeases() {
    if (this.observerLeases.length === 0) return;
    const leases = this.observerLeases;
    this.observerLeases = [];
    for (const lease of leases) {
      try { lease.dispose(); }
      catch (error) { this.observerError('SF-GC-EVENT-001', error?.message ?? error); }
    }
  }

  observerError(id, message) {
    if (this.observerErrors.length === 32) this.observerErrors.shift();
    this.observerErrors.push(Object.freeze({id, message: String(message).slice(0, 512)}));
  }

  deliver(listener, event) {
    try {
      listener(event);
    } catch (error) {
      this.observerError('SF-GC-EVENT-001', error?.message ?? error);
    }
  }

  subscribe(listener, {signal} = {}) {
    if (typeof listener !== 'function') throw new TypeError('GC event listener must be a function');
    if (this.listeners.size >= 1024) throw new RangeError('GC event listener limit exceeded');
    const subscribed = event => listener(event);
    const dispose = () => {
      this.listeners.delete(subscribed);
      this.disposers.delete(dispose);
      signal?.removeEventListener('abort', dispose);
    };
    if (!signal?.aborted) {
      this.listeners.add(subscribed);
      this.disposers.add(dispose);
      signal?.addEventListener('abort', dispose, {once: true});
    }
    return Object.freeze({dispose});
  }

  collectionStart(options = {}) {
    const generation = options.generation ?? 2;
    const reason = options.reason ?? 'Induced';
    this.activeCollection = {generation, reason, reasonCode: GCReason[reason] ?? GCReason.Internal,
      index: options.index ?? 0, type: options.blocking === false ? 'Background' : 'NonConcurrent',
      compacting: !!options.compacting};
    this.emit('GCTriggered', this.activeCollection);
    this.emit('GCSuspendEEBegin', {reason: 'SuspendForGC', generation});
    this.emit('GCSuspendEEEnd', {generation});
    this.emit('GCStart_V2', this.activeCollection);
  }

  collectionEnd(stats, options = {}) {
    const active = this.activeCollection ?? {generation: options.generation ?? 2, reason: options.reason ?? 'Induced'};
    this.emit('GCHeapStats_V2', {
      generationSizes: Object.freeze(generationSizes(stats, options.spaces)),
      generationCollections: Object.freeze([...(stats.generationCollections ?? [0, 0, 0])]),
      liveBytes: stats.liveBytes, liveObjects: stats.liveObjects, freedBytes: stats.bytesThisCollection ?? 0,
      promotedBytes: stats.promotedBytesThisCollection ?? 0
    });
    this.emit('GCEnd_V1', {...active, index: stats.collections, pauseMs: stats.lastPauseMs ?? 0,
      freedBytes: stats.bytesThisCollection ?? 0, liveBytes: stats.liveBytes,
      compacted: !!stats.compaction?.compacted, movedObjects: stats.compaction?.movedObjects ?? 0,
      movedBytes: stats.compaction?.movedBytes ?? 0, includeLarge: !!stats.compaction?.includeLarge});
    this.emit('GCRestartEEBegin', {generation: active.generation});
    this.emit('GCRestartEEEnd', {generation: active.generation});
    this.activeCollection = null;
  }

  allocationTick(reference, record) {
    this.allocatedSinceTick += record.size;
    if (this.allocatedSinceTick < this.allocationTickBytes) return;
    const allocationAmount64 = this.allocatedSinceTick;
    this.allocatedSinceTick = 0;
    this.emit('GCAllocationTick_V4', {allocationAmount64,
      allocationKind: record.space === 'large' ? 1 : record.space === 'pinned' ? 2 : 0,
      typeName: record.type, objectSize: record.size, objectId: `${reference.h}:${reference.g}`});
  }

  mark(info) {
    this.emit('GCMarkWithType', info);
  }

  segmentCreated(info) {
    this.emit('GCCreateSegment', info);
  }

  segmentReleased(info) {
    this.emit('GCFreeSegment', info);
  }

  pin(reference, record, info = {}) {
    this.emit('PinObjectAtGCTime', {...info, objectId: `${reference.h}:${reference.g}`,
      objectSize: record.size, typeName: record.type, pinCount: record.pinCount ?? 0});
  }

  finalizersBegin(info = {}) {
    this.emit('GCFinalizersBegin', info);
  }

  finalizersEnd(info = {}) {
    this.emit('GCFinalizersEnd', info);
  }

  /** Read an immutable ordered page; droppedBefore reveals overwritten records. */
  read({afterSequence = 0, limit = this.capacity} = {}) {
    gcInteger(afterSequence, 'afterSequence', 0, Number.MAX_SAFE_INTEGER);
    gcInteger(limit, 'limit', 0, Math.max(1, this.capacity));
    const events = [];
    for (let offset = 0; offset < this.length && events.length < limit; offset++) {
      const event = this.buffer[(this.start + offset) % this.capacity];
      if (event.sequence > afterSequence) events.push(event);
    }
    const oldest = this.length ? this.buffer[this.start].sequence : this.sequence + 1;
    return Object.freeze({events: Object.freeze(events), dropped: this.dropped,
      droppedBefore: Math.max(0, oldest - afterSequence - 1), sequence: this.sequence});
  }

  snapshot() {
    if (this.observersDeferred || this.deliveringObservers) {
      throw new ManagedFault('InvalidOperationException', 'Cannot snapshot during deferred GC observer delivery');
    }
    return {events: this.read().events, sequence: this.sequence, dropped: this.dropped,
      allocatedSinceTick: this.allocatedSinceTick, activeCollection: this.activeCollection,
      observerErrors: [...this.observerErrors]};
  }

  restore(state) {
    if (this.observersDeferred || this.deliveringObservers) {
      throw new ManagedFault('InvalidOperationException', 'Cannot restore during deferred GC observer delivery');
    }
    this.buffer.fill(undefined);
    const events = state.events.slice(-this.capacity);
    this.start = 0;
    this.length = this.capacity ? events.length : 0;
    for (let index = 0; index < this.length; index++) this.buffer[index] = events[index];
    this.sequence = Math.max(this.sequence, state.sequence);
    this.dropped = state.dropped;
    this.allocatedSinceTick = state.allocatedSinceTick;
    this.activeCollection = state.activeCollection;
    this.observerErrors = [...state.observerErrors];
  }

  dispose() {
    for (const dispose of [...this.disposers]) dispose();
    this.sink = null;
    this.pendingObservers.length = 0;
    this.releaseObserverLeases();
  }
}
