import { checkCancellation, loadError, LoadErrorCode } from './load-errors.js';

/** Explicit first-use dependency traversal. Cycles are graph edges, not recursive load requests. */
export class AssemblyDependencyGraph {
  #context;
  #edges = new Map();
  constructor(context) { this.#context = context; }

  async resolve(assembly, referenceIndex, options = {}) {
    if (assembly.loadContext !== this.#context) throw new TypeError('Assembly belongs to another context');
    checkCancellation(options.signal);
    const target = await assembly.resolveReference(referenceIndex, options);
    if (!this.#edges.has(assembly)) this.#edges.set(assembly, new Map());
    this.#edges.get(assembly).set(referenceIndex, target);
    return target;
  }

  /** Optional bounded full walk; ordinary assembly loads leave references unresolved. */
  async walk(root, { maxAssemblies = 10000, signal } = {}) {
    if (!Number.isSafeInteger(maxAssemblies) || maxAssemblies < 1) throw new RangeError('Invalid dependency limit');
    const seen = new Set();
    const queued = new Set([root]);
    const queue = [root];
    for (let offset = 0; offset < queue.length; offset++) {
      checkCancellation(signal);
      const assembly = queue[offset];
      if (seen.has(assembly)) continue;
      if (seen.size === maxAssemblies) throw loadError(LoadErrorCode.LimitExceeded, 'Dependency graph assembly limit exceeded');
      seen.add(assembly);
      for (let index = 1; index <= assembly.referenceCount; index++) {
        const target = await this.resolve(assembly, index, { signal });
        if (!queued.has(target)) {
          if (queued.size === maxAssemblies) throw loadError(LoadErrorCode.LimitExceeded, 'Dependency graph assembly limit exceeded');
          queued.add(target);
          queue.push(target);
        }
      }
    }
    return Object.freeze([...seen]);
  }

  edges(assembly) {
    return Object.freeze([...(this.#edges.get(assembly) ?? [])].map(([referenceIndex, target]) => Object.freeze({ referenceIndex, target })));
  }
}
