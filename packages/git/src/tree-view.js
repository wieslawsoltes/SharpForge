/** A map reader without mutation methods; the owner controls updates to its backing map. */
export class TreeView {
  #entries;
  #include;

  constructor(entries, include) {
    this.#entries = entries;
    this.#include = include;
  }
  get size() {
    if (!this.#include) return this.#entries.size;
    let count = 0;
    for (const entry of this.#entries.values()) if (this.#include(entry)) count++;
    return count;
  }
  get(path) {
    const entry = this.#entries.get(path);
    return entry && (!this.#include || this.#include(entry)) ? entry : undefined;
  }
  has(path) { return this.get(path) !== undefined; }
  *keys() { for (const [path] of this) yield path; }
  *values() { for (const [, entry] of this) yield entry; }
  *#filtered() { for (const item of this.#entries) if (this.#include(item[1])) yield item; }
  entries() { return this.#include ? this.#filtered() : this.#entries.entries(); }
  [Symbol.iterator]() { return this.entries(); }
}
