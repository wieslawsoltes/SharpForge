import { completeTypeDesc } from '../type-system/type-desc.js';
import { loadError, LoadErrorCode } from '../load-errors.js';

export function sameDefinitionBindings(left, right) {
  return left.baseType === right.baseType && left.interfaces.length === right.interfaces.length
    && left.interfaces.every((type, index) => type === right.interfaces[index]);
}

export function definitionBindings(baseType, interfaces) {
  return Object.freeze({ baseType, interfaces: Object.freeze([...interfaces]) });
}

/** Private authority for direct nominal bindings. Completed edges are already reachable from the published TypeDesc. */
export class DefinitionBindings {
  #completed = new WeakMap();
  #pending = new WeakMap();
  #maximum;

  constructor(maximum) { this.#maximum = maximum; }

  get(type) {
    let binding = this.#completed.get(type);
    if (!binding && type.isLoaded) {
      // Explicit host intrinsics are born loaded; their registered graph is their direct binding authority.
      binding = definitionBindings(type.baseType, type.interfaces);
      this.#completed.set(type, binding);
    }
    return binding;
  }

  observe(type, expected, operation) {
    // Charge the one possible comparison now; another root's publisher never spends or throws this consumer's budget.
    operation.visit(1 + expected.interfaces.length);
    const completed = this.get(type);
    if (completed) return { binding: completed, release: null };
    let pending = this.#pending.get(type);
    if (!pending) {
      pending = new Set();
      this.#pending.set(type, pending);
    }
    if (pending.size >= this.#maximum) {
      for (const reference of pending) {
        operation.visit();
        if (!reference.deref()) pending.delete(reference);
        if (pending.size < this.#maximum) break;
      }
      if (pending.size >= this.#maximum) throw loadError(LoadErrorCode.LimitExceeded, 'Concurrent generic definition observation limit exceeded');
    }
    const observer = { expected, operation };
    const reference = new WeakRef(observer);
    pending.add(reference);
    let active = true;
    return { binding: expected, release: () => {
      if (!active) return;
      active = false;
      pending.delete(reference);
      observer.operation = null;
      observer.expected = null;
      if (!pending.size && this.#pending.get(type) === pending) this.#pending.delete(type);
    } };
  }

  /** No awaits or host callbacks: authority, conflict notification and loaded publication are one coherent step. */
  publish(type, graph, binding) {
    if (type.isLoaded) return;
    this.#completed.set(type, binding);
    const pending = this.#pending.get(type);
    if (pending) {
      this.#pending.delete(type);
      for (const reference of pending) {
        const observer = reference.deref();
        if (observer?.operation && !sameDefinitionBindings(observer.expected, binding)) observer.operation.invalidateBindings();
      }
      pending.clear();
    }
    completeTypeDesc(type, graph);
  }
}
