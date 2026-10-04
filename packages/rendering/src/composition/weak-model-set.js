/** Weak bookkeeping permits application disposal without making every created native model a managed GC root. */
export class WeakModelSet {
  constructor() { this.references = new Set(); this.members = new WeakSet(); }
  add(value) {
    if (!this.members.has(value)) {
      this.members.add(value);
      this.references.add(new WeakRef(value));
    }
    return this;
  }
  *[Symbol.iterator]() {
    for (const reference of this.references) {
      const value = reference.deref();
      if (value) yield value;
      else this.references.delete(reference);
    }
  }
  clear() { this.references.clear(); this.members = new WeakSet(); }
}
