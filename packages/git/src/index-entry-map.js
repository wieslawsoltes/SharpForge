/** Preserve the path/stage map surface while maintaining its stage-zero lookup index. */
export class IndexEntryMap extends Map {
  #stageZero;
  #changed;

  constructor(stageZero, changed) {
    super();
    this.#stageZero = stageZero;
    this.#changed = changed;
  }

  set(key, value) {
    if (typeof key === 'string' && key.startsWith('0:')) this.#stageZero.set(key.slice(2), value);
    super.set(key, value);
    this.#changed();
    return this;
  }

  delete(key) {
    if (typeof key === 'string' && key.startsWith('0:')) this.#stageZero.delete(key.slice(2));
    const removed = super.delete(key);
    this.#changed();
    return removed;
  }

  clear() {
    this.#stageZero.clear();
    super.clear();
    this.#changed();
  }
}
