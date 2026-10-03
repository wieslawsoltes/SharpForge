/** Per-owner event subscriptions with explicit disposal, bounded registration and ordered delivery. */
export class ContextEvents {
  #listeners = new Map();
  on(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('Event listener must be callable');
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    const listeners = this.#listeners.get(event);
    if (listeners.size >= 1024) throw new RangeError('Context event listener limit exceeded');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  emit(event, value) {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) listener(value);
  }

  async resolve(event, value) {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      const result = await listener(value);
      if (result !== undefined && result !== null) return result;
    }
    return null;
  }

  clear() { this.#listeners.clear(); }
}
