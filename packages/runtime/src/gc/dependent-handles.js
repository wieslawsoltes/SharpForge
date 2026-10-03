import {isReference} from './reference.js';
import {ManagedFault} from './fault.js';
import {HostHandleKind} from './host-handles.js';
import {liveReference, sameReference, noteLifetimeMutation, lifetimeFault} from './lifetime-state.js';

/** Ephemerons are activated by marked keys, never by tracing values back to their keys. */
export class DependentHandleTable {
  constructor(heap, handles) {
    this.heap = heap;
    this.handles = handles;
    this.ids = new Set();
    this.activation = new Map();
    this.pending = [];
    this.head = 0;
    this.processed = new Set();
    this.seeded = false;
  }

  create(primary, secondary, options = {}) {
    this.heap.get(primary);
    if (secondary !== null) this.heap.get(secondary);
    const handle = this.handles.create(primary, {...options, kind: HostHandleKind.Dependent});
    const entry = this.handles.entry(handle, true);
    entry.secondary = secondary;
    this.index(handle.id, entry);
    this.pending.push(handle.id);
    this.heap.collector?.dependentBarrier(primary, secondary, entry.managedOwner);
    return handle;
  }

  index(id, entry) {
    this.ids.add(id);
    for (const reference of [entry.value, entry.managedOwner]) if (reference) {
      let ids = this.activation.get(reference.h);
      if (!ids) this.activation.set(reference.h, ids = new Set());
      ids.add(id);
    }
  }

  forget(id, entry) {
    if (!this.ids.delete(id)) return;
    this.detachActivation(id, entry);
    this.processed.delete(id);
  }

  detachActivation(id, entry) {
    for (const reference of [entry.value, entry.managedOwner]) if (reference) {
      const ids = this.activation.get(reference.h);
      ids?.delete(id);
      if (ids?.size === 0) this.activation.delete(reference.h);
    }
  }

  get(handle) {
    const entry = this.handles.entry(handle, true);
    if (entry.kind !== HostHandleKind.Dependent) throw lifetimeFault('A dependent handle is required');
    if (!liveReference(this.heap, entry.value)) return {primary: null, secondary: null};
    return {primary: entry.value, secondary: entry.secondary};
  }

  setSecondary(handle, secondary) {
    const entry = this.handles.entry(handle, true);
    if (entry.kind !== HostHandleKind.Dependent) throw lifetimeFault('A dependent handle is required');
    if (secondary !== null) this.heap.get(secondary);
    entry.secondary = secondary;
    this.processed.delete(handle.id);
    this.pending.push(handle.id);
    this.heap.collector?.dependentBarrier(entry.value, secondary, entry.managedOwner);
    noteLifetimeMutation(this.heap);
  }

  beginMark() {
    this.pending.length = 0;
    this.head = 0;
    this.processed.clear();
    this.seeded = false;
  }

  noteMarked(reference) {
    const ids = this.activation.get(reference.h);
    if (ids) for (const id of ids) if (!this.processed.has(id)) this.pending.push(id);
  }

  /** O(handles + activations + traced edges), including arbitrarily long dependent chains. */
  trace({isMarked, mark, drain}) {
    if (!this.seeded) {
      for (const id of this.ids) this.pending.push(id);
      this.seeded = true;
    }
    let marked = 0;
    let passes = 0;
    while (this.head < this.pending.length) {
      const end = this.pending.length;
      while (this.head < end) {
        const id = this.pending[this.head++];
        if (this.processed.has(id)) continue;
        const entry = this.heap.handles.get(id);
        if (!entry || !isMarked(entry.value) || entry.managedOwner && !isMarked(entry.managedOwner)) continue;
        this.processed.add(id);
        if (isReference(entry.secondary) && !isMarked(entry.secondary)) {
          mark(entry.secondary);
          marked++;
        }
      }
      drain();
      passes++;
    }
    return {marked, passes};
  }

  clearUnreachable(isMarked) {
    let cleared = 0;
    for (const id of this.ids) {
      const entry = this.heap.handles.get(id);
      if (!entry || entry.value === null) continue;
      if (!isMarked(entry.value) || entry.managedOwner && !isMarked(entry.managedOwner)) {
        this.detachActivation(id, entry);
        entry.value = null;
        entry.secondary = null;
        cleared++;
      }
    }
    return cleared;
  }

  visitDiagnosticEdges(visitor) {
    for (const id of this.ids) {
      const entry = this.heap.handles.get(id);
      if (entry && liveReference(this.heap, entry.value) && isReference(entry.secondary)) {
        visitor(entry.value, entry.secondary, `Dependent handle ${id}`, entry.managedOwner);
      }
    }
  }

  rebuild() {
    this.ids.clear();
    this.activation.clear();
    for (const [id, entry] of this.heap.handles) if (entry.kind === HostHandleKind.Dependent) this.index(id, entry);
    this.beginMark();
  }
}

/** Explicitly disposable host wrapper; managed tables bind their entries to a traced owner. */
export class ManagedConditionalWeakTable {
  constructor(heapOrLifetime, {owner = null, managedOwner = null} = {}) {
    this.lifetime = heapOrLifetime.lifetime ?? heapOrLifetime;
    this.owner = owner;
    this.managedOwner = managedOwner;
    this.entries = new Map();
    this.disposed = false;
    this.id = this.lifetime.trackConditionalTable(this);
  }

  requireKey(key) {
    if (this.disposed || this.lifetime.conditionalTables.get(this.id)?.table !== this) {
      throw lifetimeFault('The conditional weak table is disposed or belongs to a discarded snapshot branch');
    }
    if (key === null || key === undefined) throw new ManagedFault('ArgumentNullException', 'The conditional weak table key is null');
    this.lifetime.heap.get(key);
  }

  find(key) {
    const handle = this.entries.get(key.h);
    if (!handle) return null;
    const entry = this.lifetime.hostHandles.entry(handle);
    return entry && sameReference(entry.value, key) ? handle : null;
  }

  add(key, value) {
    this.requireKey(key);
    if (this.find(key)) throw new ManagedFault('ArgumentException', 'The conditional weak table already contains the key');
    const stale = this.entries.get(key.h);
    if (stale) this.lifetime.releaseHandle(stale);
    const handle = this.lifetime.createDependentHandle(key, value, {owner: this.owner, managedOwner: this.managedOwner});
    this.entries.set(key.h, handle);
  }

  tryGetValue(key) {
    this.requireKey(key);
    const handle = this.find(key);
    return handle ? {success: true, value: this.lifetime.getDependentHandle(handle).secondary} : {success: false, value: null};
  }

  getValue(key, factory) {
    this.requireKey(key);
    if (typeof factory !== 'function') throw new TypeError('A value factory is required');
    const existing = this.tryGetValue(key);
    if (existing.success) return existing.value;
    return this.lifetime.heap.withRoots([key], () => {
      const value = factory(key);
      const raced = this.tryGetValue(key);
      if (raced.success) return raced.value;
      this.add(key, value);
      return value;
    });
  }

  remove(key) {
    this.requireKey(key);
    const handle = this.find(key);
    if (!handle) return false;
    this.entries.delete(key.h);
    return this.lifetime.releaseHandle(handle);
  }

  clear() {
    for (const handle of this.entries.values()) this.lifetime.releaseHandle(handle);
    this.entries.clear();
  }

  dispose() {
    if (this.disposed) return false;
    this.clear();
    this.disposed = true;
    return true;
  }

  [Symbol.dispose]() { this.dispose(); }

  snapshot() {
    return {entries: [...this.entries], disposed: this.disposed};
  }

  restore(state) {
    this.entries = new Map(state.entries);
    this.disposed = state.disposed;
  }
}
