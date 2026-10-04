/** Ordered, session-owned subscriptions with deterministic disposal. */
export class WorkbenchEvents {
  #listeners = new Set();
  #disposed = false;

  subscribe(listener) {
    if (this.#disposed) throw new Error('Event source is disposed');
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(value) {
    if (this.#disposed) return;
    const errors = [];
    for (const listener of [...this.#listeners]) {
      try { listener(value); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Workbench event listener failed');
  }

  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
  }
}

export function assertId(value, name = 'Identifier') {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f]/u.test(value)) {
    throw new TypeError(name + ' must be a nonempty string up to 512 characters');
  }
  return value;
}

export function abortError(message = 'Operation cancelled') {
  return new DOMException(message, 'AbortError');
}

/** Cancels a caller's wait without pretending that an uncancellable provider has stopped. */
export function cancellable(promise, signal) {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
