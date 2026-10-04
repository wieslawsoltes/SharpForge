import {initializeHeap} from './heap-state.js';
import {allocateManaged, replaceManagedData, allocateArray} from './allocation.js';
import {visitEdges, visitEdgeRange} from './type-descriptor.js';
import {createStats} from './stats.js';
import {rootReference} from './reference.js';
import {snapshotHeap, restoreHeap} from './snapshot.js';
import {verifyHeap} from './verify.js';
import {AllocationContext} from './allocation-context.js';

const noRoots = Object.freeze([]);

/** Precise handle-indirected managed heap with per-instance collector and lifetime services. */
export class ManagedHeap {
  constructor(options = {}) {
    initializeHeap(this, options);
  }

  withRoots(values, action) {
    const start = this.pins.length;
    try {
      for (const value of values) this.pinRoot(value);
      return action();
    } finally {
      if (this.pins.length > start) this.pins.length = start;
    }
  }

  reserve(bytes, roots = noRoots) { this.limits.reserve(bytes, roots); }
  allocate(kind, type, data, roots = noRoots, options = {}) {
    return allocateManaged(this, kind, type, data, roots, options);
  }
  replaceData(reference, data) { return replaceManagedData(this, reference, data); }
  string(value, roots = noRoots, options = {}) { return this.allocate('string', 'string', String(value), roots, options); }
  object(type, fields = noRoots, options = {}) { return this.allocate('object', type, fields, noRoots, options); }
  array(type, length, options = {}) { return allocateArray(this, type, length, options); }
  get(reference) { return this.handleTable.get(reference); }
  tryGet(reference) { return this.handleTable.tryGet(reference); }
  referenceAt(handle) { return this.records[handle] ? Object.freeze({h: handle, g: this.generations[handle]}) : null; }
  getGeneration(reference) { return this.get(reference).gcGeneration; }
  noteMutation() { this.mutationRevision++; }
  createAllocationContext(options = {}) {
    const context = new AllocationContext(this, options);
    this.allocationContexts.add(context);
    return context;
  }
  pinRoot(value) { return this.writeRoot(this.pins, this.pins.length, value); }

  describe(kind, methodTable, data) {
    const dynamic = kind === 'object' && data.length > methodTable.fields.length;
    return this.descriptors.get(dynamic ? 'dynamic-object' : kind, methodTable);
  }
  visitEdges(record, visitor) { return visitEdges(record, visitor); }
  visitEdgeRange(record, start, limit, visitor, result) { return visitEdgeRange(record, start, limit, visitor, result); }

  /** Visitor categories are diagnostic metadata; only managed references affect tracing. */
  visitRoots(visitor, extraRoots = noRoots) {
    const publish = (value, category = 'stack', detail = null) => {
      visitor(rootReference(value) ?? value, category, detail);
    };
    if (this.rootVisitor) this.rootVisitor(publish);
    else for (const value of this.rootProvider()) publish(value, 'stack', 'legacy-provider');
    this.rootRegistry.visitRoots(publish);
    for (const value of this.pins) publish(value, 'pinned', 'temporary-root');
    for (const value of extraRoots) publish(value, 'stack', 'explicit-root');
    this.lifetime.visitStrongRoots(publish);
  }

  collect(extraRoots = noRoots, options = {}) {
    const roots = Array.isArray(extraRoots) ? extraRoots : [...extraRoots];
    return this.withRoots(roots, () => this.events.deferObservers(() => {
      const result = this.safepoints.withSuspension(() => this.collector.collect(roots, options), options);
      this.spaces.emitPendingEvents();
      return result;
    }));
  }

  /** Keep completed-collection roots alive until reentrant event delivery finishes. */
  retainObserverRoots(values) {
    if (!values.length || !this.events.hasObservers) return;
    if (!this.events.observersDeferred && !this.events.deliveringObservers) return;
    const lease = this.rootRegistry.register('stack', (visitor, category) => {
      for (const value of values) visitor(value, category, 'gc-observer');
    });
    this.events.releaseAfterObservers(lease);
  }

  startIncremental(options = {}) { return this.collector.startIncremental(options); }
  step(budget = 128) { return this.collector.step(budget); }

  /** Reclamation removes a record and updates every owning service exactly once. */
  reclaim(handle) {
    const record = this.records[handle];
    if (!record) return 0;
    const reference = this.referenceAt(handle);
    this.lifetime.onReclaim(reference);
    this.collector.released(reference, record);
    this.spaces.release(reference, record);
    this.handleTable.release(handle);
    this.stats.liveBytes -= record.size;
    this.stats.liveObjects--;
    this.stats.freedBytes += record.size;
    this.stats.freedObjects++;
    this.noteMutation();
    return record.size;
  }

  writeField(reference, index, value) { return this.barriers.writeField(reference, index, value); }
  writeElement(reference, index, value) { return this.barriers.writeElement(reference, index, value); }
  writeStatic(container, index, value) { return this.barriers.writeStatic(container, index, value); }
  writeRoot(container, index, value) { return this.barriers.writeRoot(container, index, value); }
  bulkCopy(destination, start, source, sourceStart, count) {
    return this.barriers.bulkCopy(destination, start, source, sourceStart, count);
  }
  fillArray(destination, start, count, value) { return this.barriers.fillArray(destination, start, count, value); }

  createHandle(value, options = {}) { return this.lifetime.createHandle(value, options); }
  getHandle(handle) { return this.lifetime.getHandle(handle); }
  setHandle(handle, value) { return this.lifetime.setHandle(handle, value); }
  releaseHandle(handle) { return this.lifetime.releaseHandle(handle); }
  pin(reference, options = {}) { return this.lifetime.pin(reference, options); }
  registerFinalizer(reference, callback, options = {}) { return this.lifetime.registerFinalizer(reference, callback, options); }
  suppressFinalize(reference) { return this.lifetime.suppressFinalize(reference); }
  reRegisterForFinalize(reference) { return this.lifetime.reRegisterForFinalize(reference); }
  drainFinalizers(options = {}) { return this.lifetime.drainFinalizers(options); }

  snapshot() { return snapshotHeap(this); }
  restore(snapshot) { return restoreHeap(this, snapshot); }
  restoreStats(stats) { this.stats = createStats(this, stats); }
  census() { return this.diagnostics.census(); }
  stamp() { return this.diagnostics.stamp(); }
  inspectPage(options = {}) { return this.diagnostics.inspectPage(options); }
  inspectRecord(handle, record) { return this.diagnostics.inspectRecord(handle, record); }
  inspect(limit = 200) { return this.diagnostics.inspect(limit); }
  retentionPath(reference, options = {}) { return this.diagnostics.retentionPath(reference, options); }
  retentionPaths(reference, options = {}) { return this.diagnostics.retentionPaths(reference, options); }
  dominators(options = {}) { return this.diagnostics.dominators(options); }
  exportDump(options = {}) { return this.diagnostics.exportDump(options); }
  verify(options = {}) { return verifyHeap(this, options); }

  /** Explicit session teardown releases frozen data and host leases as well as collectible objects. */
  dispose(options = {}) {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.shutdown(options);
    this.collector.dispose();
    this.rootRegistry.clear();
    this.pins.length = 0;
    this.rootVisitor = null;
    this.rootProvider = () => noRoots;
    for (let handle = 0; handle < this.records.length; handle++) this.reclaim(handle);
    this.counters.dispose();
    this.background.dispose();
    this.spaces.emitPendingEvents();
    this.events.dispose();
    for (const context of this.allocationContexts) context.dispose();
  }
}
