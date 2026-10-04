/** Instance-owned events. Preserve a single failure's type; report multiple failures together. */
export class CollaborationEvents {
  #listeners = new Set();

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Collaboration listener must be a function');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event) {
    const errors = [];
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Collaboration subscriber failed');
  }

  clear() {
    this.#listeners.clear();
  }
}

export function collaborationClock(clock = {}) {
  return {
    now: clock.now ?? (() => Date.now()),
    setTimeout: clock.setTimeout ?? ((callback, delay) => setTimeout(callback, delay)),
    clearTimeout: clock.clearTimeout ?? (timer => clearTimeout(timer))
  };
}
