import {MemoryArena, alignStorage} from './arena.js';
import {SlotArena} from './slot-arena.js';
import {LargeObjectHeap} from './loh.js';
import {PinnedObjectHeap} from './poh.js';
import {FrozenHeap, validateFrozenRecord} from './frozen.js';
import {primitiveStorage, writeUtf16, readUtf16} from './primitive-storage.js';
import {SpatialArrayViews} from './spatial-array-view.js';
import {createCompactionPlan, applyCompactionPlan} from './compaction.js';
import {ManagedFault} from './fault.js';
import {copySpatialRange, fillSpatialRange} from './spatial-bulk.js';
import {ArenaAllocationIndex} from './arena-allocation-index.js';

const storageBinding = Symbol('managed-storage-binding');
const spaceNames = ['small', 'large', 'pinned', 'frozen'];
const emptyInfo = () => ({
  liveBytes: 0, reservedBytes: 0, freeBytes: 0, fragmentedBytes: 0,
  largestFreeBlock: 0, objects: 0, payloadBytes: 0, hostStorageBytes: 0,
  arenaStorageBytes: 0, stringMirrorBytes: 0, arenas: 0
});
const recordTotals = () => Object.fromEntries(spaceNames.map(name => [name, {
  liveBytes: 0, payloadBytes: 0, objects: 0, stringMirrorBytes: 0
}]));

function activeBinding(record, owner) {
  const storage = record.storage;
  const binding = storage?.[storageBinding];
  return binding?.owner === owner && binding.record === record && !binding.block.released
    && binding.block.id === storage.blockId ? binding : null;
}

/** Physical stores behind stable public handles. The JS host heap itself is never compacted. */
export class HeapSpaces {
  constructor(heap, options = {}) {
    this.heap = heap;
    this.segmentBytes = alignStorage(options.arenaSegmentBytes ?? 64 * 1024);
    this.maxArenaBytes = options.maxArenaBytes ?? Math.max(heap.maxBytes, this.segmentBytes * 8);
    if (!Number.isSafeInteger(this.maxArenaBytes) || this.maxArenaBytes < 8) throw new RangeError('Invalid arena capacity limit');
    this.arenas = new Map();
    this.allocationIndex = new ArenaAllocationIndex();
    this.bindings = new Map();
    this.byHandle = new Map();
    this.views = new WeakMap();
    this.arrayViews = new SpatialArrayViews();
    this.bindingProperty = {value: null, writable: true, enumerable: false, configurable: false};
    this.recordTotals = recordTotals();
    this.pendingSegmentEvents = [];
    this.deliveringSegmentEvents = false;
    this.nextArenaId = 1;
    this.nextBlockId = 1;
    this.reservedBytes = 0;
    this.compactions = 0;
    this.large = new LargeObjectHeap(options);
    this.pinned = new PinnedObjectHeap(heap);
    this.frozen = new FrozenHeap(heap);
  }

  _allocate(space, byteLength, hostBacked) {
    const bytes = alignStorage(byteLength);
    const pool = this.allocationIndex.pool(space, hostBacked);
    let selected = pool.find(bytes);
    if (!selected) {
      const available = Math.floor((this.maxArenaBytes - this.reservedBytes) / 8) * 8;
      if (bytes > available) throw new ManagedFault('OutOfMemoryException', 'Managed arena reservation budget exhausted');
      const capacity = Math.min(Math.max(this.segmentBytes, bytes), available);
      const Type = hostBacked ? SlotArena : MemoryArena;
      selected = new Type(this.nextArenaId++, capacity, space);
      selected.segmentAnnounced = false;
      this.arenas.set(selected.id, selected);
      this.reservedBytes += selected.capacity;
      pool.add(selected);
    }
    const block = selected.allocate(this.nextBlockId++, byteLength);
    pool.updated(selected);
    if (!block) throw new Error('Arena invariant: selected block did not fit');
    block.released = false;
    return {arena: selected, block};
  }

  _announceSegment(arena) {
    if (arena.segmentAnnounced) return;
    arena.segmentAnnounced = true;
    this.pendingSegmentEvents.push({method: 'segmentCreated', info: {
      segmentId: arena.id, space: arena.space, reservedBytes: arena.capacity, hostBacked: arena.hostBacked
    }});
  }

  /** The heap drains after publication/reclamation, with returned references rooted. */
  emitPendingEvents() {
    if (this.deliveringSegmentEvents || this.pendingSegmentEvents.length === 0) return;
    const events = this.pendingSegmentEvents;
    this.pendingSegmentEvents = [];
    this.deliveringSegmentEvents = true;
    try {
      for (const event of events) this.heap.events?.[event.method]?.(event.info);
    } finally {
      this.deliveringSegmentEvents = false;
    }
  }

  _attachData(binding, initialize = null) {
    const {record, arena, block, codec, length} = binding;
    record.storage = {
      arenaId: arena.id, blockId: block.id, offset: block.offset,
      byteLength: block.byteLength, allocatedBytes: block.allocatedBytes,
      length, elementType: binding.elementType, hostBacked: arena.hostBacked,
      format: record.kind === 'string' ? 'utf16' : codec ? 'primitive' : 'slots'
    };
    // Snapshot copying enumerates scalar metadata only. Reuse the descriptor to
    // avoid allocating another temporary object for each managed allocation.
    this.bindingProperty.value = binding;
    try {
      Object.defineProperty(record.storage, storageBinding, this.bindingProperty);
    } finally {
      this.bindingProperty.value = null;
    }
    if (record.kind === 'string') {
      if (initialize !== null) writeUtf16(arena, block, initialize);
      record.data = initialize ?? readUtf16(arena, block, length);
      return;
    }
    if (initialize !== null) {
      if (binding.elementType === 'System.Byte' && initialize instanceof Uint8Array) {
        arena.bytes.set(initialize, block.offset);
      } else if (codec) {
        const view = arena.view;
        const width = codec.size;
        const begin = block.offset;
        for (let index = 0; index < length; index++) codec.write(view, begin + index * width, initialize[index]);
      } else {
        const values = arena.values;
        const begin = block.offset / 8;
        for (let index = 0; index < length; index++) values[begin + index] = initialize[index];
      }
    }
    record.data = this.arrayViews.create(binding);
    this.views.set(record.data, binding);
  }

  _account(binding, direction) {
    if (direction > 0) binding.accountedSize = binding.record.size;
    else if (binding.accountedSize === null) return;
    const totals = this.recordTotals[binding.arena.space];
    totals.liveBytes += direction * binding.accountedSize;
    totals.payloadBytes += direction * binding.block.byteLength;
    totals.objects += direction;
    if (binding.record.kind === 'string') totals.stringMirrorBytes += direction * binding.length * 2;
    if (direction < 0) binding.accountedSize = null;
  }

  /** Prepare before publication; release(null, record) rolls it back on any later failure. */
  prepare(record, options = {}) {
    if (record.storage) throw new Error('Storage is already prepared');
    const data = record.data;
    if (record.kind !== 'string' && !Array.isArray(data) && !(ArrayBuffer.isView(data) && Number.isSafeInteger(data.length))) {
      throw new TypeError('Managed slots require an indexed Array or typed array');
    }
    const element = record.kind === 'array' ? record.methodTable?.elementType : null;
    const codec = primitiveStorage(element, record.descriptor?.elementSize);
    const length = data.length;
    const byteLength = length * (record.kind === 'string' ? 2 : codec?.size ?? 8);
    alignStorage(byteLength);
    const frozen = options.frozen || record.space === 'frozen';
    const pinned = options.pinned || record.space === 'pinned';
    const space = frozen ? 'frozen' : pinned ? 'pinned' : this.large.containsSize(record.size) ? 'large' : 'small';
    if (frozen) validateFrozenRecord(this.heap, record);
    const {arena, block} = this._allocate(space, byteLength, record.kind !== 'string' && !codec);
    const binding = {
      arena, block, codec, record, owner: this, length, readOnly: !!frozen,
      elementType: codec ? element.enumUnderlyingType?.name ?? element.name : null,
      reference: null, accountedSize: null
    };
    this.bindings.set(block.id, binding);
    record.space = space;
    record.gcGeneration = space === 'small' ? record.gcGeneration ?? 0 : 2;
    try {
      this._attachData(binding, data);
      this._account(binding, 1);
    } catch (error) {
      this.release(null, record);
      record.data = data;
      throw error;
    }
    this._announceSegment(arena);
    return record;
  }

  allocated(reference) {
    const record = this.heap.get(reference);
    const binding = activeBinding(record, this);
    if (!binding) throw new Error('Storage invariant: publication without a prepared block');
    binding.reference = reference;
    binding.block.reference = reference;
    this.byHandle.set(reference.h, binding);
  }

  release(reference, record) {
    const binding = this.bindings.get(record.storage?.blockId);
    if (!binding) return false;
    if (reference && binding.reference && (reference.h !== binding.reference.h || reference.g !== binding.reference.g)) {
      throw new Error('Storage invariant: stale reference attempted to release a block');
    }
    binding.block.released = true;
    binding.arena.release(binding.block.id);
    this._account(binding, -1);
    this.bindings.delete(binding.block.id);
    if (binding.reference && this.byHandle.get(binding.reference.h) === binding) this.byHandle.delete(binding.reference.h);
    if (record.storage?.[storageBinding] === binding) record.storage[storageBinding] = null;
    record.storage = null;
    if (!binding.arena.blocks.size) {
      this.allocationIndex.pool(binding.arena.space, binding.arena.hostBacked).remove(binding.arena);
      this.arenas.delete(binding.arena.id);
      this.reservedBytes -= binding.arena.capacity;
      this._announceSegment(binding.arena);
      this.pendingSegmentEvents.push({method: 'segmentReleased', info: {
        segmentId: binding.arena.id, space: binding.arena.space,
        reservedBytes: binding.arena.capacity, hostBacked: binding.arena.hostBacked
      }});
    } else this.allocationIndex.pool(binding.arena.space, binding.arena.hostBacked).updated(binding.arena);
    return true;
  }

  /** Resize host-owned fields atomically; pinned or frozen payload addresses cannot change. */
  replaceData(reference, record, data, options = {}) {
    if (record.space === 'frozen' || record.space === 'pinned' || record.pinCount || this.heap.lifetime?.isPinned(reference)) {
      throw new ManagedFault('InvalidOperationException', 'Pinned and frozen backing stores cannot be resized');
    }
    const replacement = {...record, data, size: options.size ?? record.size, storage: null};
    this.prepare(replacement, options);
    const binding = this.bindings.get(replacement.storage.blockId);
    this.release(reference, record);
    record.storage = replacement.storage;
    record.data = replacement.data;
    record.space = replacement.space;
    record.gcGeneration = replacement.gcGeneration;
    binding.record = record;
    binding.reference = reference;
    binding.block.reference = reference;
    this.byHandle.set(reference.h, binding);
    return record;
  }

  compact({generation = 2, includeLarge = false} = {}) {
    if (generation !== 2) return {compacted: false, movedObjects: 0, movedBytes: 0};
    const before = this.memoryInfo();
    const result = {compacted: true, includeLarge, movedObjects: 0, movedBytes: 0, pinnedObjects: 0, pinnedBytes: 0};
    for (const arena of this.arenas.values()) {
      if (arena.space === 'frozen' || arena.space === 'pinned' || arena.space === 'large' && !includeLarge) continue;
      const plan = createCompactionPlan(arena, block => {
        const binding = this.bindings.get(block.id);
        return !!binding.record.pinCount || !!(binding.reference && this.heap.lifetime?.isPinned(binding.reference));
      });
      const moved = applyCompactionPlan(arena, plan, block => {
        this.bindings.get(block.id).record.storage.offset = block.offset;
      });
      this.allocationIndex.pool(arena.space, arena.hostBacked).updated(arena);
      for (const key of ['movedObjects', 'movedBytes', 'pinnedObjects', 'pinnedBytes']) result[key] += moved[key];
    }
    this.compactions++;
    const after = this.memoryInfo();
    return {...result, fragmentationBefore: before.fragmentedBytes, fragmentationAfter: after.fragmentedBytes};
  }

  bulkCopy(destination, start, source, sourceStart, count) {
    return copySpatialRange(this, destination, start, source, sourceStart, count);
  }

  fillArray(destination, start, count, value) {
    return fillSpatialRange(this, destination, start, count, value);
  }

  /** Borrow current storage without allocating; descriptor visitors own range bounds. */
  getBinding(record) {
    const binding = activeBinding(record, this);
    if (!binding) {
      throw new ManagedFault('InvalidReferenceException', 'Managed backing storage is unavailable');
    }
    return binding;
  }

  /** Direct indexed read for runtime services; no Array Proxy or string-index conversion. */
  readSlot(record, index) {
    const binding = this.getBinding(record);
    if (record.kind === 'string' || !Number.isSafeInteger(index) || index < 0 || index >= binding.length) {
      throw new ManagedFault('IndexOutOfRangeException', 'Managed slot is outside its backing storage');
    }
    return binding.codec ? binding.codec.read(binding.arena.view, binding.block.offset + index * binding.codec.size)
      : binding.arena.values[binding.block.offset / 8 + index];
  }

  memoryInfo() {
    const spaces = Object.fromEntries(spaceNames.map(name => [name, {...emptyInfo(), ...this.recordTotals[name]}]));
    for (const arena of this.arenas.values()) {
      const target = spaces[arena.space];
      const info = arena.memoryInfo();
      target.arenas++;
      for (const key of ['reservedBytes', 'freeBytes', 'fragmentedBytes']) target[key] += info[key];
      target.largestFreeBlock = Math.max(target.largestFreeBlock, info.largestFreeBlock);
      target[arena.hostBacked ? 'hostStorageBytes' : 'arenaStorageBytes'] += info.liveBytes;
    }
    const total = emptyInfo();
    for (const info of Object.values(spaces)) {
      for (const key of Object.keys(total)) {
        if (key === 'largestFreeBlock') total[key] = Math.max(total[key], info[key]);
        else total[key] += info[key];
      }
    }
    return {...total, ...spaces, spaces, compactions: this.compactions, maxArenaBytes: this.maxArenaBytes};
  }

  snapshot() {
    return {
      nextArenaId: this.nextArenaId, nextBlockId: this.nextBlockId, compactions: this.compactions,
      pendingSegmentEvents: this.pendingSegmentEvents.map(event => ({method: event.method, info: {...event.info}})),
      arenas: [...this.arenas.values()].map(arena => arena.snapshot()),
      bindings: [...this.bindings.values()].map(binding => ({
        reference: binding.reference, arenaId: binding.arena.id, blockId: binding.block.id,
        length: binding.length, elementType: binding.elementType, elementSize: binding.codec?.size ?? 0, readOnly: binding.readOnly
      })),
      frozen: this.frozen.snapshot()
    };
  }

  /** Restore after heap.records and identity generations; every view is rebound to restored bytes. */
  restore(state) {
    for (const binding of this.bindings.values()) {
      binding.block.released = true;
      const storage = binding.record.storage;
      if (storage?.[storageBinding] === binding) storage[storageBinding] = null;
    }
    this.allocationIndex.clear();
    this.arenas.clear();
    this.bindings.clear();
    this.byHandle.clear();
    this.views = new WeakMap();
    this.arrayViews = new SpatialArrayViews();
    this.recordTotals = recordTotals();
    this.reservedBytes = 0;
    for (const saved of state.arenas) {
      const arena = (saved.hostBacked ? SlotArena : MemoryArena).restore(saved);
      arena.segmentAnnounced = true;
      this.arenas.set(arena.id, arena);
      this.allocationIndex.pool(arena.space, arena.hostBacked).add(arena);
      this.reservedBytes += arena.capacity;
    }
    for (const saved of state.bindings) {
      const record = this.heap.tryGet(saved.reference);
      const arena = this.arenas.get(saved.arenaId);
      const block = arena?.blocks.get(saved.blockId);
      if (!record || !block) throw new TypeError('Invalid storage snapshot binding');
      block.released = false;
      const binding = {...saved, record, arena, block, owner: this, codec: primitiveStorage(saved.elementType, saved.elementSize)};
      this.bindings.set(block.id, binding);
      this.byHandle.set(saved.reference.h, binding);
      this._attachData(binding);
      this._account(binding, 1);
    }
    this.nextArenaId = Math.max(this.nextArenaId, state.nextArenaId);
    this.nextBlockId = Math.max(this.nextBlockId, state.nextBlockId);
    this.compactions = state.compactions;
    this.pendingSegmentEvents = (state.pendingSegmentEvents ?? []).map(event => ({method: event.method, info: {...event.info}}));
    this.frozen.restore(state.frozen);
  }
}
