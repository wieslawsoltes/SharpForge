import { abortError, workbenchError } from './state-events.js';

/** One cancellable analysis request per project; executable build requests keep their existing worker ownership. */
export class BuildAnalysis {
  constructor(service) {
    this.service = service;
    this.current = null;
  }

  get snapshot() {
    const operation = this.current;
    return operation ? Object.freeze({ epoch: operation.epoch, revision: operation.revision }) : null;
  }

  event(type, operation, details = {}) {
    this.service.events.emit({ type, projectId: this.service.id, epoch: operation.epoch,
      revision: operation.revision, background: true, ...details });
  }

  finish(operation, type, details = {}) {
    if (operation.finished) return;
    operation.finished = true;
    if (this.current === operation) {
      this.current = null;
      this.service.analyzing = false;
    }
    this.event(type, operation, details);
  }

  async run({ signal } = {}) {
    const service = this.service;
    if (service.disposed) throw workbenchError('BUILD_DISPOSED', 'Build service is disposed');
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('Analysis signal must support abort subscriptions');
    }
    if (signal?.aborted) throw abortError(signal.reason);
    this.cancel('Analysis superseded by a newer request', { superseded: true });
    const operation = { epoch: ++service.analysisEpoch, revision: service.revision,
      controller: new AbortController(), finished: false, superseded: false, error: null };
    this.current = operation;
    service.analyzing = true;
    const abort = () => this.cancel(signal.reason, { epoch: operation.epoch });
    signal?.addEventListener('abort', abort, { once: true });
    try {
      this.event('analysis-started', operation);
      const result = await service.request('analyze', {}, { signal: operation.controller.signal });
      if (operation.superseded) return null;
      if (operation.error) throw operation.error;
      if (operation.epoch !== service.analysisEpoch || operation.revision !== service.revision) {
        this.finish(operation, 'analysis-cancelled', { reason: 'Analysis result was superseded' });
        return null;
      }
      service.applyResult(result, 'analysis');
      this.event('analysis', operation, { result });
      this.finish(operation, 'analysis-completed', { result });
      return result;
    } catch (error) {
      if (operation.superseded) return null;
      const cancelled = operation.controller.signal.aborted || error.name === 'AbortError' || error.code === 'BUILD_STALE';
      this.finish(operation, cancelled ? 'analysis-cancelled' : 'analysis-failed', { error: operation.error ?? error });
      throw operation.error ?? error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (this.current === operation) {
        this.current = null;
        service.analyzing = false;
      }
    }
  }

  /** Abort only the matching request. WorkerClient drops its reply; no concurrent build is restarted or cancelled. */
  cancel(reason = 'Analysis cancelled', { epoch, superseded = false } = {}) {
    const operation = this.current;
    if (!operation || epoch !== undefined && operation.epoch !== epoch) return false;
    operation.superseded = superseded;
    operation.error = abortError(reason instanceof Error ? reason.message : reason);
    this.service.analysisEpoch++;
    operation.controller.abort(operation.error);
    this.finish(operation, 'analysis-cancelled', { error: operation.error, reason: operation.error.message });
    return true;
  }
}
