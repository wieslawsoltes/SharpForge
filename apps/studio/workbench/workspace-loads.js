import { abortError } from './events.js';

function cancelled(reason) {
  if (reason?.name === 'AbortError') return reason;
  const error = abortError('Workspace opening was cancelled');
  if (reason !== undefined) error.cause = reason;
  return error;
}

function createLoad({ state, documents, signal, current, release }) {
  const controller = new AbortController();
  const workspaceEpoch = state.workspaceEpoch;
  const nativeMode = state.nativeMode;
  const revision = documents.revision;
  let finished = false;

  const disconnect = () => signal?.removeEventListener('abort', externalAbort);
  const cancel = reason => {
    if (controller.signal.aborted || finished) return;
    disconnect();
    release();
    controller.abort(reason);
  };
  const externalAbort = () => cancel(cancelled(signal.reason));
  const check = () => {
    controller.signal.throwIfAborted();
    let message;
    if (finished) message = 'Workspace opening has already finished';
    else if (!current()) message = 'Workspace opening was superseded or disposed';
    else if (documents.disposed) message = 'The document service was disposed during workspace opening';
    else if (state.readOnly) message = 'Stop execution before opening a workspace';
    else if (state.workspaceEpoch !== workspaceEpoch) message = 'The workspace changed during opening';
    else if (state.nativeMode !== nativeMode) message = 'The workspace backend changed during opening';
    else if (documents.revision !== revision) message = 'Documents changed during workspace opening';
    if (message) {
      const error = abortError(message);
      cancel(error);
      throw error;
    }
    return true;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    disconnect();
    release();
  };
  const connect = () => {
    if (controller.signal.aborted || finished) return;
    if (signal?.aborted) externalAbort();
    else signal?.addEventListener('abort', externalAbort, { once: true });
  };
  return { cancel, connect, ticket: Object.freeze({ signal: controller.signal, check, finish }) };
}

/** Own one pending workspace load per Studio instance and release that ownership when its ticket finishes. */
export class WorkspaceLoads {
  #active = null;
  #disposed = false;

  /**
   * Begin before the first picker/read await and pass this same ticket through nested ingress calls.
   * check() throws AbortError on cancellation, disposal, or changes to documents, workspace, backend, or read-only state.
   * Call check() immediately before synchronous adoption, and finish() in finally. Adoption itself changes the captured revision.
   * The caller owns staged source cleanup; finish() only releases the ticket and its external abort listener.
   */
  begin({ state, documents, signal } = {}) {
    if (this.#disposed) throw abortError('Workspace loader is disposed');
    if (!state || typeof state !== 'object' || !documents || typeof documents !== 'object') {
      throw new TypeError('Workspace opening requires state and document service objects');
    }
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('Workspace opening requires an AbortSignal');
    }
    const operation = createLoad({
      state, documents, signal,
      current: () => !this.#disposed && this.#active === operation,
      release: () => { if (this.#active === operation) this.#active = null; }
    });
    const previous = this.#active;
    this.#active = operation;
    // Install ownership first: an abort listener may synchronously start an even newer request.
    previous?.cancel(abortError('A newer workspace opening superseded this request'));
    operation.connect();
    operation.ticket.check();
    return operation.ticket;
  }

  /** Cancel pending preparation and prevent this Studio instance from starting another load. */
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#active?.cancel(abortError('Workspace loader was disposed'));
    this.#active = null;
  }
}
