import {readWorkerRequest} from './workers/protocol.js';
import {DesignerWorkerError, serializeDesignerWorkerError} from './designer-worker-channel.js';

function requestId(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DesignerWorkerError('Worker request id must be a positive safe integer', 'BAD_REQUEST');
  }
  return value;
}

function awaitResult(value, signal) {
  return new Promise((resolve, reject) => {
    const finish = (callback, result) => {
      signal.removeEventListener('abort', canceled);
      callback(result);
    };
    const canceled = () => finish(reject, signal.reason);
    signal.addEventListener('abort', canceled, {once: true});
    Promise.resolve(value).then(result => finish(resolve, result), error => finish(reject, error));
    if (signal.aborted) canceled();
  });
}

/**
 * Compiler envelope owner. Await async handlers and abort queued requests without killing the worker.
 * Running synchronous handlers cannot process a cancel message until they yield to the worker event loop.
 */
export class DesignerWorkerDispatcher {
  constructor(protocol, {postMessage, prepare = () => {}, maxPending = 128,
    onFailure = error => queueMicrotask(() => { throw error; })} = {}) {
    if (!protocol?.registerHandler || !protocol?.dispatch || typeof postMessage !== 'function' || typeof prepare !== 'function') {
      throw new TypeError('A worker protocol, response sink and request preparation function are required');
    }
    if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 512) throw new RangeError('Invalid pending request limit');
    if (typeof onFailure !== 'function') throw new TypeError('Invalid worker failure callback');
    Object.assign(this, {protocol, postMessage, prepare, maxPending, onFailure});
    this.pending = new Map();
    this.disposed = false;
    this.unregisterCancel = protocol.registerHandler('cancelRequest', params => {
      const controller = this.pending.get(requestId(params.requestId));
      if (!controller || controller.signal.aborted) return {canceled: false};
      controller.abort(new DOMException('Compiler request canceled', 'AbortError'));
      return {canceled: true};
    });
  }

  async receive(data) {
    const id = data?.id;
    let controller = null;
    let notification = false;
    try {
      const {method, params} = readWorkerRequest(data);
      notification = method === 'cancelRequest' && id === undefined;
      if (this.disposed) throw new DesignerWorkerError('Compiler dispatcher is disposed', 'SFDW0002');
      this.protocol.assertMethod(method);
      if (!notification) requestId(id);
      if (method === 'cancelRequest') {
        const result = this.protocol.dispatch(method, params, {requestId: id});
        if (!notification) this.postMessage({id, result, revision: params.revision});
        return;
      }
      if (this.pending.has(id)) throw new DesignerWorkerError('Worker request id is already pending', 'BAD_REQUEST');
      if (this.pending.size >= this.maxPending) throw new DesignerWorkerError('Too many pending compiler requests', 'SFDW0006');
      controller = new AbortController();
      this.pending.set(id, controller);
      const context = {signal: controller.signal, requestId: id};
      this.prepare(method, params, context);
      context.signal.throwIfAborted();
      const result = await awaitResult(this.protocol.dispatch(method, params, context), context.signal);
      context.signal.throwIfAborted();
      if (!this.disposed) this.postMessage({id, result, revision: params.revision});
    } catch (error) {
      if (this.disposed) return;
      try {
        if (notification) this.postMessage({event: 'requestError', error: serializeDesignerWorkerError(error)});
        else this.postMessage({id, error: serializeDesignerWorkerError(error)});
      } catch (failure) {
        this.onFailure(failure);
      }
    } finally {
      if (controller && this.pending.get(id) === controller) this.pending.delete(id);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterCancel();
    const reason = new DesignerWorkerError('Compiler dispatcher is disposed', 'SFDW0002');
    for (const controller of this.pending.values()) controller.abort(reason);
    this.pending.clear();
  }
}

/** Preserve active compiler preparation; isolated designer candidates never replace the active workspace. */
export function createCompilerWorkerDispatcher(protocol, {workspace, configureExtensions, extensionKey, ...options}) {
  const prepare = (method, params) => {
    if (method === 'designAnalyze' || method === 'designResourceAnalyze') return;
    if (params.files) {
      const names = new Set(params.files.map(file => file.uri));
      for (const uri of workspace.documents.keys()) if (!names.has(uri)) workspace.remove(uri);
      for (const file of params.files) workspace.update(file.uri, file.text, file.version);
    }
    const compilationOptions = params.compilationOptions ?? (params.outputKind ? {outputKind: params.outputKind} : null);
    if (compilationOptions && JSON.stringify(compilationOptions) !== JSON.stringify(workspace.compilationOptions)) {
      workspace.compilationOptions = compilationOptions;
      workspace.result = null;
    }
    if (Object.hasOwn(params, 'extensions') && JSON.stringify(params.extensions ?? null) !== extensionKey()) {
      configureExtensions(params.extensions);
    }
  };
  return new DesignerWorkerDispatcher(protocol, {...options, prepare});
}
