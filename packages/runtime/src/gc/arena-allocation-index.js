import {SpatialSizeIndex} from './spatial-size-index.js';

function compare(left, right) {
  return left.size - right.size || left.arena.id - right.arena.id || left.offset - right.offset;
}

/** One space/representation pool. Full arenas are absent from both searchable trees. */
export class ArenaAllocationPool {
  constructor() {
    this.members = new Map();
    this.holes = new SpatialSizeIndex(compare);
    this.holeEntries = new WeakMap();
    this.tails = new SpatialSizeIndex(compare);
    this.current = null;
  }

  add(arena) {
    if (this.members.has(arena)) throw new Error('Allocation index invariant: duplicate arena');
    const entry = {arena, size: arena.capacity - arena.highWater, offset: arena.highWater, indexed: false};
    this.members.set(arena, entry);
    arena.free.observer = this;
    arena.free.owner = arena;
    for (const hole of arena.free.starts.values()) this.addHole(arena, hole);
    this.updated(arena);
  }

  addHole(arena, block) {
    const entry = {arena, size: block.size, offset: block.offset};
    this.holeEntries.set(block, entry);
    this.holes.add(entry);
  }

  removeHole(arena, block) {
    const entry = this.holeEntries.get(block);
    if (!entry || entry.arena !== arena) throw new Error('Allocation index invariant: unknown free block');
    this.holes.remove(entry);
    this.holeEntries.delete(block);
  }

  _select(entry) {
    const next = this.members.get(entry.arena);
    if (next === this.current) return;
    if (next.indexed) {
      this.tails.remove(next);
      next.indexed = false;
    }
    if (this.current?.size > 0) {
      this.tails.add(this.current);
      this.current.indexed = true;
    }
    this.current = next;
  }

  /** Best fit across holes and tails; ordinary bump allocation touches no tree nodes. */
  find(bytes) {
    if (!this.holes.root && !this.tails.root) return this.current?.size >= bytes ? this.current.arena : null;
    const hole = this.holes.find(bytes);
    let tail = this.tails.find(bytes);
    if (this.current?.size >= bytes && (!tail || compare(this.current, tail) < 0)) tail = this.current;
    const best = !hole || tail && compare(tail, hole) < 0 ? tail : hole;
    if (!best) return null;
    this._select(best);
    return best.arena;
  }

  /** Called once after an arena allocation, release or completed compaction. */
  updated(arena) {
    const entry = this.members.get(arena);
    if (!entry) throw new Error('Allocation index invariant: unregistered arena');
    if (entry.indexed) {
      this.tails.remove(entry);
      entry.indexed = false;
    }
    entry.size = arena.capacity - arena.highWater;
    entry.offset = arena.highWater;
    if (entry === this.current) {
      if (entry.size === 0) this.current = null;
    } else if (entry.size > 0) {
      if (!this.current) this.current = entry;
      else {
        this.tails.add(entry);
        entry.indexed = true;
      }
    }
  }

  remove(arena) {
    const entry = this.members.get(arena);
    if (!entry) return;
    if (entry === this.current) this.current = null;
    else if (entry.indexed) this.tails.remove(entry);
    for (const hole of arena.free.starts.values()) this.removeHole(arena, hole);
    arena.free.observer = null;
    arena.free.owner = null;
    this.members.delete(arena);
  }

  clear() {
    for (const arena of this.members.keys()) {
      arena.free.observer = null;
      arena.free.owner = null;
    }
    this.members.clear();
    this.holes.clear();
    this.holeEntries = new WeakMap();
    this.tails.clear();
    this.current = null;
  }
}

/** Explicit per-heap owner: no arena scan or per-allocation pool key is required. */
export class ArenaAllocationIndex {
  constructor() {
    this.pools = Object.create(null);
  }

  pool(space, hostBacked) {
    let representations = this.pools[space];
    if (!representations) this.pools[space] = representations = [null, null];
    const index = hostBacked ? 1 : 0;
    return representations[index] ?? (representations[index] = new ArenaAllocationPool());
  }

  clear() {
    for (const representations of Object.values(this.pools)) {
      for (const pool of representations) pool?.clear();
    }
  }
}
