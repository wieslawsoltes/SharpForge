import { abortError } from './state-events.js';

/** A displayed build task cancels the queue and compiler generation captured when it began. */
export class BuildTasks {
  constructor({ builds, queue, tasks, onError = () => {} }) {
    Object.assign(this, { builds, queue, tasks, onError });
    this.operations = new Map();
    this.disposed = false;
  }

  receive(event) {
    if (this.disposed) return;
    if (event.type === 'started') return this.begin(event);
    if (!['completed', 'failed', 'cancelled', 'removed'].includes(event.type)) return;
    const record = this.operations.get(event.projectId);
    if (!record || event.type !== 'removed' && record.epoch !== event.epoch) return;
    this.finish(record, event.type === 'completed' ? null : event.error ?? abortError('Build cancelled'));
  }

  begin(event) {
    const service = this.builds.get(event.projectId);
    if (!service) return;
    const previous = this.operations.get(event.projectId);
    if (previous) this.finish(previous, abortError('Build superseded'));
    const record = { service, epoch: event.epoch, operation: null, finished: false, error: null };
    const cancelQueue = this.queue?.captureCancellation(event.projectId);
    record.cancel = () => {
      if (record.finished || this.builds.get(event.projectId) !== service || service.buildEpoch !== record.epoch) return false;
      return cancelQueue ? cancelQueue('Build cancelled from Background Tasks')
        : service.cancel('Build cancelled from Background Tasks', { epoch: record.epoch });
    };
    this.operations.set(event.projectId, record);
    try {
      record.operation = this.tasks.begin({ label: 'Build ' + event.projectId, projectId: event.projectId, cancel: record.cancel });
      if (record.finished) record.error ? record.operation.fail(record.error) : record.operation.complete();
    } catch (error) {
      record.cancel();
      this.finish(record, abortError('Build cannot be tracked'));
      this.onError(error);
    }
  }

  finish(record, error) {
    if (record.finished) return;
    record.finished = true;
    record.error = error;
    if (this.operations.get(record.service.id) === record) this.operations.delete(record.service.id);
    if (error) record.operation?.fail(error);
    else record.operation?.complete();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of [...this.operations.values()]) {
      record.cancel();
      this.finish(record, abortError('Build task bridge disposed'));
    }
  }
}
