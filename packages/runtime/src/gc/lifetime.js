import {HostHandleKind, HostHandleTable} from './host-handles.js';
import {VirtualAddressSpace} from './address-space.js';
import {PinManager} from './pinning.js';
import {DependentHandleTable, ManagedConditionalWeakTable} from './dependent-handles.js';
import {ManagedWeakReference} from './weak-reference.js';
import {ManagedGCHandle, GCHandleType} from './gc-handle.js';
import {ManagedFinalizationRegistry} from './finalization.js';
import {HostResourceTable, ManagedSafeHandle} from './safe-handle.js';
import {shutdownLifetime} from './shutdown.js';
import {sameReference, lifetimeFault} from './lifetime-state.js';

/** Heap-owned lifetime services. No host GC scheduling participates in managed reachability. */
export class LifetimeManager {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.closed = false;
    this.shutdownReport = null;
    this.finalizerResolver = options.finalizerResolver ?? null;
    this.finalizerExecutor = options.finalizerExecutor ?? null;
    this.onFinalizerFault = options.onFinalizerFault ?? null;
    this.waitForPendingFinalizersHook = null;
    this.addresses = new VirtualAddressSpace(heap, options);
    this.pinning = new PinManager(heap, this.addresses);
    this.hostHandles = new HostHandleTable(heap, this.pinning, options);
    this.dependents = new DependentHandleTable(heap, this.hostHandles);
    this.hostHandles.onRelease = (id, entry) => this.dependents.forget(id, entry);
    this.finalizers = new ManagedFinalizationRegistry(this, options);
    this.resources = new HostResourceTable(this);
    this.conditionalTables = new Map();
    this.tableOwners = new Map();
    this.nextTableId = 1;
    this.safeHandles = new Map();
    this.managedInstanceInvoker = null;
  }

  requireOpen() {
    if (this.closed) throw lifetimeFault('The managed heap lifetime session has stopped');
  }

  allocated(reference, record) {
    const registration = this.finalizerResolver?.(reference, record) ?? record.descriptor?.finalizer ?? null;
    if (registration === null || registration === undefined) return;
    const callback = registration.callback ?? registration;
    this.registerFinalizer(reference, callback, {critical: registration.critical ?? record.descriptor?.criticalFinalizer ?? false});
  }

  createHandle(value, options) {
    this.requireOpen();
    if (options?.kind === HostHandleKind.Dependent) return this.createDependentHandle(value, options.secondary ?? null, options);
    return this.hostHandles.create(value, options);
  }

  getHandle(handle) { return this.hostHandles.get(handle); }
  setHandle(handle, value) {
    this.requireOpen();
    this.hostHandles.set(handle, value);
  }
  releaseHandle(handle) { return this.hostHandles.release(handle); }
  bindHandleOwner(handle, reference) { this.hostHandles.bindManagedOwner(handle, reference); }

  createWeakReference(target = null, options) {
    return new ManagedWeakReference(this, target, options);
  }

  createGCHandle(target, type = GCHandleType.Normal, options) {
    return ManagedGCHandle.alloc(this, target, type, options);
  }

  createDependentHandle(primary, secondary, options) {
    this.requireOpen();
    return this.dependents.create(primary, secondary, options);
  }

  getDependentHandle(handle) { return this.dependents.get(handle); }
  setDependentSecondary(handle, value) { this.dependents.setSecondary(handle, value); }
  createConditionalWeakTable(options) {
    this.requireOpen();
    return new ManagedConditionalWeakTable(this, options);
  }

  trackConditionalTable(table) {
    this.requireOpen();
    const id = this.nextTableId++;
    if (!Number.isSafeInteger(id)) throw lifetimeFault('Conditional weak table identity exhausted');
    this.conditionalTables.set(id, {table, owner: table.managedOwner});
    if (table.managedOwner) {
      let ids = this.tableOwners.get(table.managedOwner.h);
      if (!ids) this.tableOwners.set(table.managedOwner.h, ids = new Set());
      ids.add(id);
    }
    return id;
  }

  registerFinalizer(reference, callback, options) {
    this.requireOpen();
    return this.finalizers.register(reference, callback, options);
  }

  suppressFinalize(reference) { return this.finalizers.suppress(reference); }
  reRegisterForFinalize(reference) {
    this.requireOpen();
    return this.finalizers.reRegister(reference);
  }
  drainFinalizers(options) { return this.finalizers.drain(options); }
  waitForPendingFinalizers(options) { return this.finalizers.wait(options); }

  pin(reference, options) {
    this.requireOpen();
    return this.pinning.acquire(reference, options);
  }
  isPinned(reference) { return this.pinning.isPinned(reference); }
  addressOfPinnedObject(reference, byteOffset = 0) { return this.addresses.addressOf(reference, byteOffset); }

  createSafeHandle(resource, release, options) {
    this.requireOpen();
    return new ManagedSafeHandle(this, resource, release, options);
  }

  bindSafeHandle(reference, token) {
    this.heap.get(reference);
    const previous = this.safeHandles.get(reference.h);
    if (previous && sameReference(previous.reference, reference)) throw lifetimeFault('The managed SafeHandle is already initialized');
    this.safeHandles.set(reference.h, {reference, token});
    const finalizer = this.finalizers.entries.get(reference.h);
    if (finalizer && sameReference(finalizer.reference, reference)) finalizer.critical = true;
    else this.registerFinalizer(reference, () => {}, {critical: true});
  }

  completeFinalizer(reference) {
    const entry = this.safeHandles.get(reference.h);
    if (entry && sameReference(entry.reference, reference)) this.resources.close(entry.token);
  }

  visitStrongRoots(visitor) {
    this.hostHandles.visitStrongRoots(visitor);
    this.pinning.visitRoots(visitor);
    this.finalizers.visitRoots(visitor);
  }

  beginMark() { this.dependents.beginMark(); }
  noteMarked(reference) { this.dependents.noteMarked(reference); }

  /** Weak-short precedes f-reachability; weak-long follows its transitive/dependent closure. */
  finishMark(context) {
    const before = this.dependents.trace(context);
    const shortWeakCleared = this.hostHandles.clearWeak(HostHandleKind.WeakShort, context.isMarked);
    const finalizersQueued = this.finalizers.discover(context);
    const after = this.dependents.trace(context);
    const longWeakCleared = this.hostHandles.clearWeak(HostHandleKind.WeakLong, context.isMarked);
    const dependentsCleared = this.dependents.clearUnreachable(context.isMarked);
    return {dependentPasses: before.passes + after.passes, dependentMarked: before.marked + after.marked,
      shortWeakCleared, longWeakCleared, finalizersQueued, dependentsCleared};
  }

  visitDiagnosticEdges(visitor) { this.dependents.visitDiagnosticEdges(visitor); }

  onReclaim(reference) {
    this.hostHandles.onReclaim(reference);
    this.finalizers.onReclaim(reference);
    this.addresses.deactivate(reference);
    const safeHandle = this.safeHandles.get(reference.h);
    if (safeHandle && sameReference(safeHandle.reference, reference)) this.safeHandles.delete(reference.h);
    const tables = this.tableOwners.get(reference.h);
    if (tables) for (const id of tables) {
      const entry = this.conditionalTables.get(id);
      if (entry && sameReference(entry.owner, reference)) {
        entry.table.dispose();
        this.conditionalTables.delete(id);
        tables.delete(id);
      }
    }
    if (tables?.size === 0) this.tableOwners.delete(reference.h);
  }

  releaseOwner(owner) {
    const resources = this.resources.releaseOwner(owner);
    const handles = this.hostHandles.releaseOwner(owner);
    const pins = this.pinning.releaseOwner(owner);
    return {handles, pins, resources: resources.released, errors: resources.errors};
  }

  leakReport(options) {
    return {handles: this.hostHandles.leakReport(options), pins: this.pinning.report(), resources: this.resources.report()};
  }

  shutdown() { return shutdownLifetime(this); }

  snapshot() {
    return {closed: this.closed, shutdownReport: this.shutdownReport, addresses: this.addresses.snapshot(),
      pins: this.pinning.snapshot(), handles: this.hostHandles.snapshot(), finalizers: this.finalizers.snapshot(),
      resources: this.resources.snapshot(), nextTableId: this.nextTableId,
      safeHandles: [...this.safeHandles].map(([id, entry]) => [id, {...entry}]),
      tables: [...this.conditionalTables].map(([id, entry]) => [id, {...entry, state: entry.table.snapshot()}])};
  }

  assertRestorable(state) { this.resources.assertRestorable(state.resources); }

  restore(state) {
    this.assertRestorable(state);
    this.closed = state.closed;
    this.shutdownReport = state.shutdownReport;
    this.addresses.restore(state.addresses);
    this.pinning.restore(state.pins);
    this.hostHandles.restore(state.handles);
    this.dependents.rebuild();
    this.resources.restore(state.resources);
    this.safeHandles = new Map(state.safeHandles.map(([id, entry]) => [id, {...entry}]));
    this.nextTableId = Math.max(this.nextTableId, state.nextTableId);
    this.conditionalTables.clear();
    this.tableOwners.clear();
    for (const [id, entry] of state.tables) {
      entry.table.restore(entry.state);
      this.conditionalTables.set(id, {table: entry.table, owner: entry.owner});
      if (entry.owner) {
        let ids = this.tableOwners.get(entry.owner.h);
        if (!ids) this.tableOwners.set(entry.owner.h, ids = new Set());
        ids.add(id);
      }
    }
    this.finalizers.restore(state.finalizers);
  }
}
