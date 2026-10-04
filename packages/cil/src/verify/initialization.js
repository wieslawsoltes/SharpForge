import { dataflowCancellation, dataflowFailure, dataflowLimit } from './dataflow.js';

/** Copy-on-write local assignment facts. Null is the immutable all-unassigned entry state.
 * Snapshots never escape the solver; intersections can only remove definitely assigned bits.
 */
class LocalInitialization {
  #words;
  #remaining;
  #signal;
  #incoming = null;
  #scratch = null;
  #dirty = false;

  constructor(count, limit, signal) {
    this.#words = Math.ceil(count / 32);
    this.#remaining = limit;
    this.#signal = signal;
  }

  #charge(words) {
    dataflowCancellation(this.#signal);
    if (words > this.#remaining) dataflowFailure('Local initialization word-work budget exceeded');
    this.#remaining -= words;
  }

  restore(incoming) {
    this.#incoming = incoming;
    this.#dirty = false;
  }

  assigned(index) {
    const values = this.#dirty ? this.#scratch : this.#incoming;
    return !!(values && values[index >>> 5] & (1 << (index & 31)));
  }

  assign(index) {
    if (this.assigned(index)) return;
    if (!this.#dirty) {
      if (!this.#scratch) {
        this.#charge(this.#words);
        this.#scratch = new Uint32Array(this.#words);
      }
      this.#charge(this.#words);
      if (this.#incoming) this.#scratch.set(this.#incoming);
      else this.#scratch.fill(0);
      this.#dirty = true;
    }
    this.#scratch[index >>> 5] |= 1 << (index & 31);
  }

  snapshot() {
    if (!this.#dirty) return this.#incoming;
    this.#charge(this.#words);
    this.#incoming = this.#scratch.slice();
    this.#dirty = false;
    return this.#incoming;
  }

  merge(incoming, stored) {
    if (incoming === stored || stored === null) return stored;
    if (incoming === null) return null;
    this.#charge(this.#words);
    let changed = false;
    let nonzero = false;
    for (let index = 0; index < this.#words; index++) {
      const value = (incoming[index] & stored[index]) >>> 0;
      changed ||= value !== stored[index];
      nonzero ||= value !== 0;
    }
    if (!changed) return stored;
    if (!nonzero) return null;
    this.#charge(this.#words * 2);
    const merged = new Uint32Array(this.#words);
    for (let index = 0; index < this.#words; index++) merged[index] = incoming[index] & stored[index];
    return merged;
  }
}

/** The portable default requires InitLocals. The explicit ECMA extension proves prior assignments instead. */
export function localInitialization(method, count, options) {
  const policy = options.localInitialization === undefined ? 'portable' : options.localInitialization;
  if (policy !== 'portable' && policy !== 'definite-assignment') dataflowFailure('Unknown local initialization policy');
  const limit = dataflowLimit(options.maxInitializationWords, 1000000, 1000000);
  return policy === 'definite-assignment' && !method.initLocals && count ?
    new LocalInitialization(count, limit, options.signal) : null;
}
