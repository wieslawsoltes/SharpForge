import { loadError, LoadErrorCode } from './load-errors.js';

/** Explicit GC bridge roots. Root leases retain their context until released; weak roots do not retain targets. */
export class ContextRoots {
  #context;
  #strong = new Map();
  #weak = new Map();
  #sequence = 0;
  #maxRoots;
  constructor(context, { maxRoots = 65536 } = {}) {
    if (!Number.isSafeInteger(maxRoots) || maxRoots < 1) throw new RangeError('Invalid context root limit');
    this.#context = new WeakRef(context);
    this.#maxRoots = maxRoots;
  }

  add(target, { weak = false, kind = 'instance' } = {}) {
    const context = this.#context.deref();
    if (!context) throw loadError(LoadErrorCode.Disposed, 'Load context was collected');
    context.ensureActive();
    if ((typeof target !== 'object' || target === null) && typeof target !== 'function') throw new TypeError('GC roots require objects');
    if (this.#strong.size + this.#weak.size >= this.#maxRoots) throw loadError(LoadErrorCode.LimitExceeded, 'Context root limit exceeded');
    const id = ++this.#sequence;
    const entries = weak ? this.#weak : this.#strong;
    entries.set(id, { target: weak ? new WeakRef(target) : target, kind });
    let retainedContext = weak ? null : context;
    let released = false;
    return Object.freeze({
      id, weak,
      release: () => {
        if (released) return;
        released = true;
        entries.delete(id);
        retainedContext = null;
      },
      get context() { return retainedContext; },
    });
  }

  /** Enumerate only explicit managed roots, without exposing the mutable registry. */
  enumerate({ includeWeak = false } = {}) {
    const roots = [...this.#strong].map(([id, entry]) => Object.freeze({ id, kind: entry.kind, target: entry.target, weak: false }));
    if (includeWeak) {
      for (const [id, entry] of this.#weak) {
        const target = entry.target.deref();
        if (target) roots.push(Object.freeze({ id, kind: entry.kind, target, weak: true }));
        else this.#weak.delete(id);
      }
    }
    return Object.freeze(roots);
  }

  get strongCount() { return this.#strong.size; }
}
