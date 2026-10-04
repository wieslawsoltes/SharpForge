/** Synchronous factories share temporary roots only until their outermost construction operation completes. */
export class UIConstructionRoots {
  constructor({isReference = value => value !== null && typeof value === 'object', key = value => value,
    maxRoots = 1000000, maxDepth = 512} = {}) {
    if (!Number.isSafeInteger(maxRoots) || maxRoots < 1 || !Number.isSafeInteger(maxDepth) || maxDepth < 1) {
      throw new RangeError('Construction budgets must be positive safe integers.');
    }
    this.isReference = isReference;
    this.key = key;
    this.maxRoots = maxRoots;
    this.maxDepth = maxDepth;
    this.depth = 0;
    this.references = null;
  }

  get size() { return this.references?.size ?? 0; }

  retain(value) {
    if (!this.references || !this.isReference(value)) return value;
    const key = this.key(value);
    if (!this.references.has(key) && this.references.size >= this.maxRoots) {
      throw new RangeError('UI construction root budget exceeded.');
    }
    this.references.set(key, value);
    return value;
  }

  run(action, roots = []) {
    if (typeof action !== 'function') throw new TypeError('A synchronous construction action is required.');
    if (this.depth >= this.maxDepth) throw new RangeError('UI construction recursion budget exceeded.');
    const outer = this.depth === 0;
    if (outer) this.references = new Map();
    this.depth++;
    try {
      for (const value of roots) this.retain(value);
      const result = action();
      if (result?.then) throw new TypeError('UI construction cannot cross an asynchronous boundary.');
      return result;
    } finally {
      this.depth--;
      if (outer) {
        this.references.clear();
        this.references = null;
      }
    }
  }

  *roots() { if (this.references) yield* this.references.values(); }
}

/** Optional host seam: standalone model users retain normal synchronous factory behavior. */
export function withUIConstruction(host, action, roots = []) {
  return host?.withConstruction ? host.withConstruction(action, roots) : action();
}
