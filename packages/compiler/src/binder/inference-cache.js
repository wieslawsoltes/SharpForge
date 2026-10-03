/**
 * Memoization of `infer`, the string-typed pipeline's "what type will this expression have" query.
 *
 * `infer` is side-effect free and is asked about the same syntax node many times: a call infers its receiver once to
 * look for a framework method, once for a builtin and once for a user method, and each of those receivers does the
 * same for its own receiver. Without a memo the work is 3^depth for a chain of calls or member accesses.
 *
 * An inferred type depends on the syntax node, on the locals in scope and on the declared methods and types, so a
 * memo is valid exactly while those stay the same. Two policies are provided:
 *
 * - `MemoizedInference` (bound pipeline) keeps the memo across queries and forgets it whenever the scope chain, a
 *   local or the set of declared methods/types changes. Binding a chain is then linear in its length.
 * - `CallScopedInference` (legacy method compiler, kept as the parity oracle) keeps the memo for the duration of one
 *   outermost `infer` call only, which needs no knowledge of how that compiler tracks scopes. One query is linear in
 *   the size of the expression; binding a chain of depth n is O(n^2) instead of O(3^n).
 */

/** Inferred types per syntax node, with the counters the complexity tests assert on. */
export class InferenceCache {
  constructor() {
    this.types = new Map();
    /** Number of `infer` evaluations that were not answered from the memo. */
    this.computations = 0;
    /** Number of `infer` calls answered from the memo. */
    this.hits = 0;
    /** Bumped on every `forget`; a result computed across a `forget` is not stored. */
    this.generation = 0;
    this.methodCount = -1;
    this.typeCount = -1;
  }

  /** Drops every remembered type. */
  forget() {
    this.generation++;
    if (this.types.size) this.types.clear();
  }

  /** Forgets the memo when methods or types were declared since the last query (local functions, lambdas). */
  syncDeclarations(compilation) {
    const methodCount = compilation.methods.length,
      typeCount = compilation.types.length;
    if (methodCount === this.methodCount && typeCount === this.typeCount) return;
    this.methodCount = methodCount;
    this.typeCount = typeCount;
    this.forget();
  }
}

/** Bound-pipeline policy: the memo lives until the scope chain, a local or the declared members change. */
export const MemoizedInference = Base =>
  class MemoizedInference extends Base {
    /** The innermost binder of the scope chain. Assigning it (entering or leaving a scope) forgets inferred types. */
    get scope() {
      return this.currentScope;
    }

    set scope(binder) {
      this.currentScope = binder;
      this.inferredTypes?.forget();
    }

    local(...declaration) {
      const local = super.local(...declaration);
      this.inferredTypes?.forget();
      return local;
    }

    infer(node) {
      if (!node) return 'error';
      const cache = (this.inferredTypes ??= new InferenceCache());
      cache.syncDeclarations(this.c);
      const known = cache.types.get(node);
      if (known !== undefined) {
        cache.hits++;
        return known;
      }
      cache.computations++;
      const generation = cache.generation,
        type = super.infer(node);
      if (type !== undefined && generation === cache.generation) cache.types.set(node, type);
      return type;
    }
  };

/** Legacy-compiler policy: the memo lives for one outermost `infer` call. */
export const CallScopedInference = Base =>
  class CallScopedInference extends Base {
    infer(node) {
      if (!node) return 'error';
      const cache = (this.inferredTypes ??= new InferenceCache());
      const known = cache.types.get(node);
      if (known !== undefined) {
        cache.hits++;
        return known;
      }
      cache.computations++;
      const outermost = !this.inferring;
      this.inferring = true;
      try {
        const type = super.infer(node);
        if (type !== undefined && !outermost) cache.types.set(node, type);
        return type;
      } finally {
        if (outermost) {
          this.inferring = false;
          cache.forget();
        }
      }
    }
  };
