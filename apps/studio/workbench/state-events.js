/** Per-owner, ordered events. Reentrant emissions are drained after the current event. */
export class WorkbenchEvents {
  constructor() {
    this.listeners = new Set();
    this.sequence = 0;
    this.queue = [];
    this.draining = false;
    this.disposed = false;
  }

  subscribe(listener, { signal } = {}) {
    if (typeof listener !== 'function') throw new TypeError('An event listener must be a function');
    if (this.disposed) throw new Error('Event source is disposed');
    if (signal?.aborted) return () => {};
    const entry = { listener, signal, unsubscribe: null };
    const unsubscribe = () => {
      this.listeners.delete(entry);
      signal?.removeEventListener('abort', unsubscribe);
    };
    entry.unsubscribe = unsubscribe;
    this.listeners.add(entry);
    signal?.addEventListener('abort', unsubscribe, { once: true });
    return unsubscribe;
  }

  emit(event) {
    if (this.disposed) return;
    const descriptors = Object.getOwnPropertyDescriptors(event);
    descriptors.sequence = { value: ++this.sequence, enumerable: true };
    this.queue.push(Object.freeze(Object.defineProperties({}, descriptors)));
    if (this.draining) return;
    this.draining = true;
    const failures = [];
    try {
      for (let index = 0; index < this.queue.length; index++) {
        const next = this.queue[index];
        for (const entry of [...this.listeners]) {
          if (!this.listeners.has(entry)) continue;
          try { entry.listener(next); } catch (error) { failures.push(error); }
        }
      }
    } finally {
      this.queue.length = 0;
      this.draining = false;
    }
    if (failures.length) throw new AggregateError(failures, 'Workbench event listeners failed');
  }

  dispose() {
    for (const entry of this.listeners) entry.unsubscribe();
    this.queue.length = 0;
    this.disposed = true;
  }
}

/** Errors carry stable machine-readable codes without changing the worker protocol. */
export function workbenchError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = 'WorkbenchError';
  error.code = code;
  return error;
}

export function abortError(reason = 'Operation cancelled') {
  if (reason instanceof Error) return reason;
  const error = new Error(String(reason));
  error.name = 'AbortError';
  error.code = 'ABORTED';
  return error;
}

export function requireIdentifier(value, name = 'Identifier') {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f]/u.test(value)) {
    throw new TypeError(`${name} must be a nonempty string without control characters`);
  }
  return value;
}
