const eventModes = Object.freeze({
  alloc: {alloc: true}, allocation: {alloc: true},
  call: {calls: true}, 'call-return': {calls: true},
  instruction: {every: 1}, instructions: {every: 1},
  all: {alloc: true, calls: true, every: 1, backedges: true, slices: true}
});

function settings(option) {
  if (option === undefined && typeof process !== 'undefined') option = process.env?.SHARPFORGE_GC_STRESS;
  if (!option || option === 'off') return {enabled: false, alloc: false, calls: false, every: 0, backedges: false, slices: false};
  if (option === true) option = 'all';
  if (typeof option === 'string') {
    if (/^instructions?:\d+$/.test(option)) option = {every: Number(option.split(':')[1])};
    else option = eventModes[option] ?? (() => { throw new RangeError('Unknown GC stress mode'); })();
  }
  if (!option || typeof option !== 'object') throw new TypeError('GC stress must name a mode or configuration');
  const every = option.every ?? option.instructionInterval ?? 0;
  if (!Number.isSafeInteger(every) || every < 0) throw new RangeError('GC stress instruction interval must be nonnegative');
  return {enabled: true, alloc: !!option.alloc, calls: !!option.calls, every,
    backedges: !!option.backedges, slices: !!option.slices};
}

/** Deterministic forced collections. Disabled execution does not allocate or sample sites. */
export class GCStress {
  constructor(heap, option) {
    this.heap = heap;
    this.options = settings(option);
    this.enabled = this.options.enabled;
    this.instructions = 0;
    this.collections = 0;
    this.active = false;
    this.lastSite = null;
  }

  beforeAllocation(extraRoots = [], site = null) {
    if (this.enabled && this.options.alloc) this.collect('allocation', extraRoots, site);
  }

  safepoint(kind, extraRoots = [], detail = null) {
    if (!this.enabled || this.active) return false;
    let selected = false;
    if (kind === 'instruction') selected = this.options.every > 0 && ++this.instructions % this.options.every === 0;
    else if (kind === 'call' || kind === 'return') selected = this.options.calls;
    else if (kind === 'back-edge') selected = this.options.backedges;
    else if (kind === 'slice-boundary') selected = this.options.slices;
    if (selected) this.collect(kind, extraRoots, detail);
    return selected;
  }

  collect(kind, extraRoots, site) {
    if (this.active) return;
    this.active = true;
    this.lastSite = site ?? this.heap.allocationSites?.provider?.() ?? kind;
    try {
      this.heap.collect(extraRoots, {generation: 2, reason: 'GCStress', blocking: true});
      this.collections++;
    } catch (error) {
      error.gcStress = {kind, allocationSite: this.lastSite, collection: this.collections};
      throw error;
    } finally {
      this.active = false;
    }
  }

  snapshot() {
    return {instructions: this.instructions, collections: this.collections, lastSite: this.lastSite};
  }

  restore(state) {
    this.instructions = state?.instructions ?? 0;
    this.collections = state?.collections ?? 0;
    this.lastSite = state?.lastSite ?? null;
    this.active = false;
  }
}
