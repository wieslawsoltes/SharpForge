import { abortError } from './state-events.js';

const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const phases = new Map([['queued', 0], ['running', 1], ['cancelling', 2], ['succeeded', 3], ['failed', 3], ['cancelled', 3]]);

function boundedText(value, fallback) {
  return String(value ?? fallback).replace(/[\u0000-\u001f]/gu, ' ').slice(0, 480);
}

function checkedJob(job) {
  if (!job || typeof job.id !== 'string' || !job.id || job.id.length > 512 || /[\u0000-\u001f]/u.test(job.id)) {
    throw new TypeError('Native job requires a bounded identifier');
  }
  if (!phases.has(job.status)) throw new TypeError('Unknown native job status');
  const cursor = job.nextCursor;
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new RangeError('Invalid native job cursor');
  const progress = job.progress;
  if (progress !== undefined && progress !== null && (!Number.isFinite(progress) || progress < 0 || progress > 1)) {
    throw new RangeError('Native progress must be a measured fraction between zero and one');
  }
  return { id: job.id, status: job.status, cursor, progress, error: boundedText(job.error, 'Native job failed'),
    projectId: job.request?.project ?? null, action: boundedText(job.request?.action, 'operation') };
}

/** Adapts observed native job snapshots; cancellation captures the exact client and job instead of the current UI selection. */
export class NativeTaskBridge {
  constructor({ tasks, onError, historyLimit = 200 }) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1 || historyLimit > 2000) throw new RangeError('Invalid native task history limit');
    Object.assign(this, { tasks, onError, historyLimit });
    this.owners = new WeakMap();
    this.ownerSerial = 0;
    this.active = new Map();
    this.finished = new Map();
    this.pending = new Set();
    this.disposed = false;
  }

  key(owner, id) {
    if (!owner || typeof owner !== 'object' && typeof owner !== 'function') throw new TypeError('Native task owner must be an object');
    if (!this.owners.has(owner)) this.owners.set(owner, ++this.ownerSerial);
    return this.owners.get(owner) + ':' + id;
  }

  finish(key, record, status, error) {
    if (this.active.get(key) !== record) return;
    this.active.delete(key);
    this.finished.set(key, status);
    while (this.finished.size > this.historyLimit) this.finished.delete(this.finished.keys().next().value);
    if (status === 'succeeded') record.operation.complete({ honorCancellation: false });
    else record.operation.fail(status === 'cancelled' ? abortError(error?.message ?? 'Native job cancelled') : error);
  }

  cancel(key, record) {
    if (this.active.get(key) !== record || record.cancelling) return;
    if (!record.operation) { record.cancelRequested = true; return; }
    record.cancelling = true;
    record.operation.reportStatus('Cancellation requested');
    const pending = Promise.resolve().then(() => record.cancel()).then(job => {
      if (job && job.id !== record.id) throw new Error('Native cancellation replied for a different job');
      if (job && !this.disposed) this.update(job, { owner: record.owner, cancel: record.cancel });
    }).catch(error => {
      this.finish(key, record, 'failed', error);
      this.onError(error);
    }).finally(() => this.pending.delete(pending));
    this.pending.add(pending);
  }

  update(job, { owner = this, cancel } = {}) {
    if (this.disposed) return null;
    const snapshot = checkedJob(job);
    const key = this.key(owner, snapshot.id);
    if (this.finished.has(key)) return null;
    let record = this.active.get(key);
    if (!record) {
      if (typeof cancel !== 'function' && !terminal.has(snapshot.status)) throw new TypeError('Running native tasks require a captured cancellation callback');
      record = { owner, cancel: cancel ?? (() => null), id: snapshot.id,
        cursor: -1, phase: -1, cancelling: false, operation: null };
      this.active.set(key, record);
      try {
        record.operation = this.tasks.begin({
          label: `Native ${snapshot.action}: ${boundedText(snapshot.projectId, snapshot.id)}`.slice(0, 512),
          projectId: snapshot.projectId, cancel: () => this.cancel(key, record) });
      } catch (error) { this.active.delete(key); throw error; }
      if (record.cancelRequested) this.cancel(key, record);
    }
    if (snapshot.cursor !== undefined && snapshot.cursor < record.cursor || phases.get(snapshot.status) < record.phase) return record.operation.id;
    record.cursor = snapshot.cursor ?? record.cursor;
    record.phase = phases.get(snapshot.status);
    const message = record.cancelling && !terminal.has(snapshot.status) ? 'Cancellation requested · ' + snapshot.status : snapshot.status;
    if (snapshot.progress !== undefined && snapshot.progress !== null) record.operation.report(snapshot.progress, message);
    else record.operation.reportStatus(message);
    if (terminal.has(snapshot.status)) this.finish(key, record, snapshot.status, new Error(snapshot.error));
    return record.operation.id;
  }

  fail(id, error, { owner = this } = {}) {
    const key = this.key(owner, id);
    const record = this.active.get(key);
    if (!record) return false;
    this.finish(key, record, error?.name === 'AbortError' ? 'cancelled' : 'failed', error);
    return true;
  }

  get settled() { return Promise.all([...this.pending]); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, record] of [...this.active]) {
      record.operation.cancel();
      this.finish(key, record, 'cancelled', abortError('Native task bridge disposed'));
    }
    this.finished.clear();
  }
}
