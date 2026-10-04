/** Explicit document notifications for optional editor features; registrations are disposable. */
export function createDocumentEvents() {
  const listeners = new Set();
  let closed = false;
  const emit = event => {
    if (closed) return;
    for (const listener of listeners) listener(Object.freeze(event));
  };
  return {
    subscribe(listener) {
      if (closed) throw new Error('Document events are disposed');
      if (typeof listener !== 'function') throw new TypeError('Document listener is required');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(uri, text) {
      emit({ uri, text });
    },
    /** Read an immutable source snapshot only if a subscriber requests text; cache its value or error. */
    publishSource(uri, readText) {
      if (typeof readText !== 'function') throw new TypeError('A document source reader is required');
      if (closed || !listeners.size) return;
      emit(lazyDocumentChange(uri, readText));
    },
    reset() { emit({ type: 'reset' }); },
    dispose() { closed = true; listeners.clear(); }
  };
}

function lazyDocumentChange(uri, readText) {
  let resolved = false;
  let failed = false;
  let value;
  return {
    uri,
    get text() {
      if (!resolved) {
        resolved = true;
        try { value = readText(); }
        catch (error) { failed = true; value = error; }
        readText = undefined;
      }
      if (failed) throw value;
      return value;
    }
  };
}

/** Snapshot immutable source strings before a bulk transaction mutates or replaces file records. */
export function captureStudioDocuments(files) {
  return new Map(files.map(file => [file.uri, file.text]));
}

/** Publish completed changes, including removals, so optional features cannot retain stale source ranges. */
export function publishStudioDocumentChanges(documents, previous, files) {
  const next = captureStudioDocuments(files);
  for (const [uri, text] of next) if (previous.get(uri) !== text) documents.publish(uri, text);
  for (const uri of previous.keys()) if (!next.has(uri)) documents.publish(uri, undefined);
}
