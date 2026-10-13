import { loadError, LoadErrorCode } from '../load-errors.js';

/** Operation-owned dependency edges; both DFS passes are iterative and charge the shared generic work budget. */
export class ClosureGraph {
  #edges = new Map();
  #work;

  constructor(work) { this.#work = work; }

  node(value) {
    this.#work.visit();
    if (!this.#edges.has(value)) this.#edges.set(value, new Map());
  }

  edge(from, to, expanding) {
    this.node(from);
    this.node(to);
    const outgoing = this.#edges.get(from);
    outgoing.set(to, expanding || outgoing.get(to) === true);
  }

  #order() {
    const seen = new Set();
    const order = [];
    for (const node of this.#edges.keys()) {
      this.#work.visit();
      if (seen.has(node)) continue;
      seen.add(node);
      const stack = [{ node, edges: this.#edges.get(node).keys() }];
      while (stack.length) {
        this.#work.visit();
        const current = stack[stack.length - 1];
        const next = current.edges.next();
        if (next.done) {
          order.push(current.node);
          stack.pop();
        } else if (!seen.has(next.value)) {
          seen.add(next.value);
          stack.push({ node: next.value, edges: this.#edges.get(next.value).keys() });
        }
      }
    }
    return order;
  }

  #components(order) {
    const reverse = new Map();
    for (const node of this.#edges.keys()) {
      this.#work.visit();
      reverse.set(node, []);
    }
    for (const [from, edges] of this.#edges) {
      for (const to of edges.keys()) {
        this.#work.visit();
        reverse.get(to).push(from);
      }
    }
    const components = new Map();
    let component = 0;
    for (let index = order.length - 1; index >= 0; index--) {
      this.#work.visit();
      if (components.has(order[index])) continue;
      const pending = [order[index]];
      while (pending.length) {
        this.#work.visit();
        const node = pending.pop();
        if (components.has(node)) continue;
        components.set(node, component);
        for (const parent of reverse.get(node)) {
          this.#work.visit();
          if (!components.has(parent)) pending.push(parent);
        }
      }
      component++;
    }
    return components;
  }

  rejectCycles({ expandingOnly, reason }) {
    const components = this.#components(this.#order());
    for (const [from, edges] of this.#edges) {
      for (const [to, expanding] of edges) {
        this.#work.visit();
        if ((!expandingOnly || expanding) && components.get(from) === components.get(to)) {
          throw loadError(LoadErrorCode.TypeLoad, reason);
        }
      }
    }
  }

  clear() { this.#edges.clear(); }
}
