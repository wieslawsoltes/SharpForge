import { abortError } from './state-events.js';
import { NativeTaskBridge } from './native-task-bridge.js';

/** Adds analysis and native operations to the existing TaskCenter; build/search registrations remain with their current owners. */
export class BackgroundTaskBridge {
  constructor({ tasks, builds, onError = () => {} }) {
    if (!tasks?.begin || !builds?.subscribe) throw new TypeError('Background tasks require TaskCenter and BuildServices');
    Object.assign(this, { tasks, builds, onError });
    this.analyses = new Map();
    this.disposed = false;
    this.lastError = null;
    this.native = new NativeTaskBridge({ tasks, onError: error => this.report(error) });
    this.unsubscribe = builds.subscribe(event => this.receive(event));
    for (const service of builds.list()) {
      if (service.analysisOperation) this.receive({ type: 'analysis-started', projectId: service.id, ...service.analysisOperation });
    }
  }

  report(error) {
    this.lastError = error;
    this.onError(error);
  }

  receive(event) {
    if (this.disposed) return;
    try {
      if (event.type === 'removed') {
        const record = this.analyses.get(event.projectId);
        if (record) this.finish(event.projectId, record, 'analysis-cancelled', abortError('Project removed'));
        return;
      }
      if (!event.type.startsWith('analysis-')) return;
      if (event.type === 'analysis-started') return this.beginAnalysis(event);
      const record = this.analyses.get(event.projectId);
      if (!record || record.epoch !== event.epoch) return;
      if (['analysis-completed', 'analysis-failed', 'analysis-cancelled'].includes(event.type)) {
        this.finish(event.projectId, record, event.type, event.error);
      }
    } catch (error) { this.report(error); }
  }

  beginAnalysis(event) {
    const previous = this.analyses.get(event.projectId);
    if (previous?.epoch === event.epoch) return;
    if (previous) this.finish(event.projectId, previous, 'analysis-cancelled', abortError('Analysis superseded'));
    const service = this.builds.get(event.projectId);
    if (!service || service.analysisOperation?.epoch !== event.epoch) return;
    const record = { service, epoch: event.epoch, operation: null };
    try {
      record.operation = this.tasks.begin({ projectId: event.projectId,
        label: ('Analyze ' + (service.project.name ?? event.projectId)).slice(0, 512),
        cancel: () => service.cancelAnalysis('Analysis cancelled from Background Tasks', { epoch: record.epoch }) });
    } catch (error) {
      service.cancelAnalysis('Analysis cannot be tracked: ' + error.message, { epoch: record.epoch });
      throw error;
    }
    this.analyses.set(event.projectId, record);
    record.operation.reportStatus('Analyzing');
  }

  finish(projectId, record, type, error) {
    if (this.analyses.get(projectId) !== record) return;
    this.analyses.delete(projectId);
    if (type === 'analysis-completed') record.operation.complete();
    else record.operation.fail(type === 'analysis-cancelled' ? abortError(error?.message ?? 'Analysis cancelled') : error);
  }

  /** Supply the captured client as owner and a callback cancelling this job's exact id. */
  nativeJob(job, options) {
    if (this.disposed) return null;
    try { return this.native.update(job, options); }
    catch (error) { this.report(error); return null; }
  }

  nativeFailure(id, error, options) {
    if (this.disposed) return false;
    return this.native.fail(id, error, options);
  }

  get settled() { return this.native.settled; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const [projectId, record] of [...this.analyses]) {
      record.service.cancelAnalysis('Background task bridge disposed', { epoch: record.epoch });
      this.finish(projectId, record, 'analysis-cancelled', abortError('Background task bridge disposed'));
    }
    this.native.dispose();
  }
}
