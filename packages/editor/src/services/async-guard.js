/** Captures a persistent document identity without flattening model-backed source text. */
export function editorRevision(editor) {
  const snapshot = editor.model?.snapshot?.();
  const source = snapshot ?? editor.sourceSnapshot?.();
  const text = source ? undefined : editor.value;
  return {uri: editor.uri, version: editor.model?.version ?? source?.version ?? 0, model: editor.model,
    snapshot, get text() { return source?.text ?? text; }};
}

export function sameRevision(left, right) {
  return left.uri === right.uri && left.version === right.version && left.model === right.model &&
    (left.snapshot && right.snapshot ? left.snapshot === right.snapshot : left.text === right.text);
}

/** One independently cancellable generation per feature; stale results are never published. */
export class AsyncRequestGuard {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.requests = new Map();
    this.disposed = false;
  }

  async run(key, provider, parameters = {}, options = {}) {
    if (this.disposed) return undefined;
    this.cancel(key);
    const controller = new AbortController();
    const revision = this.snapshot();
    const request = {controller, revision};
    this.requests.set(key, request);
    const abort = () => controller.abort();
    if (options.signal?.aborted) abort();
    options.signal?.addEventListener('abort', abort, {once: true});
    try {
      const result = await provider({...parameters, uri: revision.uri, version: revision.version, signal: controller.signal});
      if (this.disposed || controller.signal.aborted || this.requests.get(key) !== request) return undefined;
      if (!sameRevision(revision, this.snapshot())) return undefined;
      if (options.validateResponseVersion !== false && result?.version !== undefined && result.version !== revision.version) return undefined;
      return {value: result, revision};
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return undefined;
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (this.requests.get(key) === request) this.requests.delete(key);
    }
  }

  cancel(key) {
    this.requests.get(key)?.controller.abort();
    this.requests.delete(key);
  }

  cancelAll() {
    for (const request of this.requests.values()) request.controller.abort();
    this.requests.clear();
  }

  dispose() {
    this.disposed = true;
    this.cancelAll();
  }
}
