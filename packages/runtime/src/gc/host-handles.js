import {isReference} from './reference.js';
import {RootCategory} from './roots.js';
import {liveReference, sameReference, noteLifetimeMutation, lifetimeFault} from './lifetime-state.js';

export const HostHandleKind = Object.freeze({
  Strong: 'Strong', WeakShort: 'WeakShort', WeakLong: 'WeakLong', Pinned: 'Pinned', Dependent: 'Dependent'
});

const kinds = new Set(Object.values(HostHandleKind));
const weakKinds = new Set([HostHandleKind.WeakShort, HostHandleKind.WeakLong, HostHandleKind.Dependent]);
const rootCategories = new Set(Object.values(RootCategory));

/** Explicit host roots with independent heap identity, ownership tags and leak diagnostics. */
export class HostHandleTable {
  constructor(heap, pinning, {debugHandles = false} = {}) {
    this.heap = heap;
    this.pinning = pinning;
    this.debug = !!debugHandles;
    this.owners = new Map();
    this.managedOwners = new Map();
    this.onRelease = null;
  }

  create(value, options = {}) {
    const kind = options.kind ?? (options.weak ?
      options.trackResurrection ? HostHandleKind.WeakLong : HostHandleKind.WeakShort : HostHandleKind.Strong);
    if (!kinds.has(kind)) throw new TypeError('Unknown host handle kind');
    const category = options.category ?? RootCategory.Handle;
    if (!rootCategories.has(category)) throw new TypeError('Unknown host handle root category');
    if (isReference(value)) this.heap.get(value);
    else if (weakKinds.has(kind) && (value !== null || options.weak === true)) {
      throw new TypeError('Weak and dependent handles require a managed reference or null');
    }
    if (kind === HostHandleKind.Pinned && value !== null && !isReference(value)) {
      throw new TypeError('Pinned handles require a managed reference or null');
    }
    if (options.managedOwner !== undefined && options.managedOwner !== null) this.heap.get(options.managedOwner);
    const id = this.heap.nextHandleId;
    if (!Number.isSafeInteger(id)) throw new RangeError('Handle identity exhausted');
    const ownerTag = options.owner ?? null;
    const pin = kind === HostHandleKind.Pinned && value !== null ? this.pinning.acquire(value, {owner: ownerTag, reason: 'GCHandle'}) : null;
    const handle = Object.freeze({id, owner: this.heap.handleOwner});
    const entry = {value, kind, category, weak: weakKinds.has(kind), ownerTag, managedOwner: options.managedOwner ?? null,
      creationStack: (options.captureStack ?? this.debug) ? new Error('Host handle created').stack : null,
      pinId: pin?.id ?? null, secondary: null, pointer: null};
    this.heap.nextHandleId++;
    this.heap.handles.set(id, entry);
    this.index(id, entry);
    this.adjustCount(entry, 1);
    if (!entry.weak) this.heap.collector?.rootBarrier(value);
    noteLifetimeMutation(this.heap);
    return handle;
  }

  index(id, entry) {
    let owner = this.owners.get(entry.ownerTag);
    if (!owner) this.owners.set(entry.ownerTag, owner = new Set());
    owner.add(id);
    if (entry.managedOwner) {
      let managed = this.managedOwners.get(entry.managedOwner.h);
      if (!managed) this.managedOwners.set(entry.managedOwner.h, managed = new Set());
      managed.add(id);
    }
  }

  adjustCount(entry, delta) {
    const field = entry.weak ? 'hostWeakHandles' : 'hostStrongHandles';
    this.heap.stats[field] = (this.heap.stats[field] ?? 0) + delta;
    if (entry.kind === HostHandleKind.Dependent) {
      this.heap.stats.hostDependentHandles = (this.heap.stats.hostDependentHandles ?? 0) + delta;
    }
    if (entry.kind === HostHandleKind.Pinned) {
      this.heap.stats.hostPinnedHandles = (this.heap.stats.hostPinnedHandles ?? 0) + delta;
    }
  }

  entry(handle, required = false) {
    const entry = handle?.owner === this.heap.handleOwner ? this.heap.handles.get(handle.id) : null;
    if (!entry && required) throw lifetimeFault('The handle is freed, invalid, or belongs to another heap');
    return entry ?? null;
  }

  get(handle) {
    const entry = this.entry(handle);
    if (!entry) return null;
    if (entry.weak && isReference(entry.value) && !liveReference(this.heap, entry.value)) return null;
    return entry.value;
  }

  set(handle, value) {
    const entry = this.entry(handle, true);
    if (entry.kind === HostHandleKind.Dependent) throw lifetimeFault('Use the dependent-handle secondary setter');
    if (isReference(value)) this.heap.get(value);
    else if ((entry.weak || entry.kind === HostHandleKind.Pinned) && value !== null) {
      throw new TypeError('This handle kind requires a managed reference or null');
    }
    const pin = entry.kind === HostHandleKind.Pinned && value !== null ?
      this.pinning.acquire(value, {owner: entry.ownerTag, reason: 'GCHandle'}) : null;
    if (entry.pinId !== null) this.pinning.releaseId(entry.pinId);
    entry.pinId = pin?.id ?? null;
    entry.value = value;
    if (!entry.weak) this.heap.collector?.rootBarrier(value);
    noteLifetimeMutation(this.heap);
  }

  bindManagedOwner(handle, reference) {
    this.heap.get(reference);
    const entry = this.entry(handle, true);
    if (entry.managedOwner) throw lifetimeFault('The handle already has a managed owner');
    entry.managedOwner = reference;
    this.index(handle.id, entry);
  }

  release(handle) {
    if (handle?.owner !== this.heap.handleOwner) return false;
    return this.releaseId(handle.id);
  }

  releaseId(id) {
    const entry = this.heap.handles.get(id);
    if (!entry) return false;
    this.heap.handles.delete(id);
    this.onRelease?.(id, entry);
    if (entry.pinId !== null) this.pinning.releaseId(entry.pinId);
    const owner = this.owners.get(entry.ownerTag);
    owner?.delete(id);
    if (owner?.size === 0) this.owners.delete(entry.ownerTag);
    if (entry.managedOwner) {
      const managed = this.managedOwners.get(entry.managedOwner.h);
      managed?.delete(id);
      if (managed?.size === 0) this.managedOwners.delete(entry.managedOwner.h);
    }
    this.adjustCount(entry, -1);
    noteLifetimeMutation(this.heap);
    return true;
  }

  releaseOwner(owner) {
    const ids = this.owners.get(owner);
    const count = ids?.size ?? 0;
    if (ids) for (const id of ids) this.releaseId(id);
    return count;
  }

  onReclaim(reference) {
    const owned = this.managedOwners.get(reference.h);
    if (owned) for (const id of owned) {
      if (sameReference(this.heap.handles.get(id)?.managedOwner, reference)) this.releaseId(id);
    }
  }

  visitStrongRoots(visitor) {
    for (const [id, entry] of this.heap.handles) if (!entry.weak) {
      visitor(entry.value, entry.category ?? RootCategory.Handle, `Strong host handle ${id}`);
    }
  }

  clearWeak(kind, isMarked) {
    let count = 0;
    for (const entry of this.heap.handles.values()) {
      if (entry.kind === kind && entry.value !== null && !isMarked(entry.value)) {
        entry.value = null;
        count++;
      }
    }
    return count;
  }

  leakReport({owner = undefined} = {}) {
    const report = [];
    for (const [id, entry] of this.heap.handles) if (owner === undefined || entry.ownerTag === owner) {
      report.push({id, kind: entry.kind, owner: entry.ownerTag, creationStack: entry.creationStack,
        target: liveReference(this.heap, entry.value) ? entry.value : null, managedOwner: entry.managedOwner});
    }
    return report;
  }

  snapshot() {
    return {owner: this.heap.handleOwner, nextId: this.heap.nextHandleId,
      entries: [...this.heap.handles].map(([id, entry]) => [id, {...entry}])};
  }

  restore(state) {
    if (state.owner !== this.heap.handleOwner) throw new TypeError('Host handle snapshot belongs to another heap');
    this.heap.nextHandleId = Math.max(this.heap.nextHandleId, state.nextId);
    this.heap.handles = new Map(state.entries.map(([id, entry]) => [id, {...entry}]));
    this.owners.clear();
    this.managedOwners.clear();
    for (const field of ['hostStrongHandles', 'hostWeakHandles', 'hostDependentHandles', 'hostPinnedHandles']) this.heap.stats[field] = 0;
    for (const [id, entry] of this.heap.handles) {
      this.index(id, entry);
      this.adjustCount(entry, 1);
    }
  }
}
