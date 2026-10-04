import {DesignSyncError} from '@sharpforge/designer';
import {designerAnalysisOptions} from './designer-worker-cache.js';

const cancelled = message => new DesignSyncError(message, 'SFSYNC_CANCELLED');

/** Defer bounded reads so queued obsolete requests can be dropped. A running synchronous compiler is never forcibly interrupted. */
export class DesignerWorkerQueue {
  constructor({maxPending = 256} = {}) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 1024) {
      throw new RangeError('Designer request queue limit must be between 1 and 1024.');
    }
    this.maxPending = maxPending;
    this.pending = new Map();
    this.latest = new Map();
    this.serial = 0;
    this.disposed = false;
  }

  run(params, context, operation) {
    if (this.disposed || context.signal?.aborted) return Promise.reject(cancelled('Designer request was cancelled before it started.'));
    const id = ++this.serial;
    const options = designerAnalysisOptions(params);
    const coalesced = ['analyze', 'catalog'].includes(params.operation ?? 'analyze') && typeof params.requestOwner === 'string';
    const key = coalesced ? JSON.stringify([params.workspaceId, params.requestOwner, params.uri,
      options.className, options.methodName, params.operation ?? 'analyze']) : null;
    const revision = {generation: params.generation ?? 0, source: params.revision ?? 0, id};
    const previous = key && this.latest.get(key);
    if (previous && (previous.generation > revision.generation
      || previous.generation === revision.generation && previous.source > revision.source)) {
      return Promise.reject(cancelled('A newer source revision is already queued.'));
    }
    if (key) {
      for (const entry of this.pending.values()) if (entry.key === key) entry.cancel('A newer designer read superseded this request.');
    }
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new DesignSyncError('Pending designer request limit exceeded.', 'SFSYNC_LIMIT'));
    }
    if (key) {
      this.latest.delete(key);
      this.latest.set(key, revision);
      if (this.latest.size > this.maxPending * 2) this.latest.delete(this.latest.keys().next().value);
    }
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(entry.timer);
        context.signal?.removeEventListener('abort', abort);
        this.pending.delete(id);
      };
      const entry = {key, cancel: message => { finish(); reject(cancelled(message)); }, timer: null};
      const abort = () => entry.cancel('Designer request was cancelled.');
      this.pending.set(id, entry);
      context.signal?.addEventListener('abort', abort, {once: true});
      entry.timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        if (this.disposed || context.signal?.aborted) { abort(); return; }
        finish();
        try { resolve(operation({...params, signal: context.signal})); }
        catch (error) { reject(error); }
      }, 0);
      if (context.signal?.aborted) abort();
    });
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.pending.values()) entry.cancel('Designer worker was disposed.');
    this.latest.clear();
  }
}
