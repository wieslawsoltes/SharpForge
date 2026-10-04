import { WorkerClient } from './worker-client.js';
import { WorkbenchEvents, abortError, requireIdentifier, workbenchError } from './state-events.js';
import { BuildAnalysis } from './build-analysis.js';

/** A compiler worker, artifact cache and cancellation domain belong to exactly one project. */
export class BuildService {
  constructor(project, { workerFactory, compilerUrl, snapshot, output, diagnostics, onError } = {}) {
    this.id = requireIdentifier(project.id ?? project.path, 'Project id');
    this.project = { ...project, id: this.id };
    this.snapshotProvider = snapshot;
    this.output = output;
    this.diagnostics = diagnostics;
    this.events = new WorkbenchEvents();
    this.revision = 0;
    this.result = null;
    this.buildResult = null;
    this.analysisResult = null;
    this.image = null;
    this.assembly = null;
    this.pdb = null;
    this.dirty = true;
    this.busy = false;
    this.analyzing = false;
    this.buildEpoch = 0;
    this.analysisEpoch = 0;
    this.analysis = new BuildAnalysis(this);
    this.disposed = false;
    this.worker = new WorkerClient(compilerUrl ?? new URL('../compiler.worker.js', import.meta.url), {
      kind: 'compiler', workerFactory, name: `compiler:${this.id}`, onError
    });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }

  configure(project) {
    this.project = { ...this.project, ...project, id: this.id };
    this.invalidate('configuration');
    return this;
  }

  snapshot() {
    const supplied = this.snapshotProvider?.(this.id, this.project) ?? this.project.snapshot ?? this.project;
    const files = supplied.files ?? [];
    if (!Array.isArray(files)) throw new TypeError('Build snapshot requires a file array');
    return {
      ...supplied,
      files: files.map(file => ({ uri: file.uri ?? file.path, text: file.text, version: file.version ?? 1 })),
      assemblyName: supplied.assemblyName ?? this.project.name ?? this.id.split('/').at(-1).replace(/\.[^.]+$/, ''),
      revision: this.revision
    };
  }

  invalidate(reason = 'source') {
    this.dirty = true;
    this.revision++;
    this.analysis.cancel('Project changed during analysis', { superseded: true });
    this.events.emit({ type: 'invalidated', projectId: this.id, revision: this.revision, reason });
  }

  async request(method, params = {}, options = {}) {
    if (this.disposed) throw workbenchError('BUILD_DISPOSED', 'Build service is disposed');
    const revision = this.revision;
    const snapshot = this.snapshot();
    const result = await this.worker.request(method, { ...snapshot, ...params, revision }, options);
    if (revision !== this.revision) throw workbenchError('BUILD_STALE', `Project '${this.id}' changed while '${method}' was running`);
    return result;
  }

  async build({ signal, force = false, background = false } = {}) {
    if (this.disposed) throw workbenchError('BUILD_DISPOSED', 'Build service is disposed');
    if (signal?.aborted) throw abortError(signal.reason);
    if (!force && !this.dirty && this.buildResult?.success && this.assembly) return this.buildResult;
    if (this.busy) throw workbenchError('BUILD_BUSY', `Project '${this.id}' is already building`);
    const epoch = ++this.buildEpoch;
    const revision = this.revision;
    this.busy = true;
    this.output?.append('Build', `Build started: ${this.project.name ?? this.id}\n`, { projectId: this.id });
    const abort = () => this.cancel(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      this.events.emit({ type: 'started', projectId: this.id, revision, epoch, background });
      if (epoch !== this.buildEpoch || signal?.aborted) throw abortError(signal?.reason ?? 'Project build cancelled');
      const loading = this.snapshot().loadingDiagnostics ?? [];
      const errors = loading.filter(diagnostic => diagnostic.severity === 'error');
      const result = errors.length ? {
        success: false, diagnostics: loading, image: null, assembly: null, metrics: { errors: errors.length }
      } : await this.request('build', {}, { signal });
      if (epoch !== this.buildEpoch || revision !== this.revision) throw workbenchError('BUILD_STALE', 'Build result was superseded');
      this.applyResult(result, 'build', errors.length && this.diagnostics?.projects.get(this.id)?.has('project') ? [] : result.diagnostics);
      const label = result.success ? 'succeeded' : 'failed';
      this.output?.append('Build', `Build ${label}: ${this.project.name ?? this.id}\n`, {
        projectId: this.id, severity: result.success ? 'success' : 'error'
      });
      this.events.emit({ type: 'completed', projectId: this.id, result, revision, epoch, background });
      return result;
    } catch (error) {
      const cancelled = signal?.aborted || epoch !== this.buildEpoch;
      this.events.emit({ type: cancelled ? 'cancelled' : 'failed', projectId: this.id, error, revision, epoch, background });
      throw cancelled ? abortError(signal?.reason ?? 'Project build cancelled') : error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (epoch === this.buildEpoch) this.busy = false;
      this.events.emit({ type: 'idle', projectId: this.id, busy: this.busy, epoch });
    }
  }

  analyze(options) { return this.analysis.run(options); }

  get analysisOperation() { return this.analysis.snapshot; }

  cancelAnalysis(reason, options) { return this.analysis.cancel(reason, options); }

  applyResult(result, source = 'build', publishedDiagnostics = result?.diagnostics) {
    if (!result || !Array.isArray(result.diagnostics)) throw new TypeError('Malformed compiler result');
    this.result = result;
    if (source === 'build') this.buildResult = result;
    else this.analysisResult = result;
    this.diagnostics?.replace(this.id, source, publishedDiagnostics, { revision: this.revision });
    if (source === 'build') {
      this.image = result.success ? result.image : null;
      this.assembly = result.success ? result.assembly : null;
      this.pdb = result.success ? result.pdb ?? null : null;
      this.dirty = !result.success;
    }
  }

  cancel(reason = 'Project build cancelled', { epoch: expectedEpoch } = {}) {
    if (this.disposed || expectedEpoch !== undefined && expectedEpoch !== this.buildEpoch) return false;
    const epoch = this.buildEpoch;
    this.buildEpoch++;
    this.analysis.cancel(reason);
    this.busy = false;
    this.worker.restart(abortError(reason));
    this.events.emit({ type: 'cancelled', projectId: this.id, reason, epoch });
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.analysis.cancel('Build service disposed');
    this.disposed = true;
    this.worker.dispose();
    this.events.dispose();
  }
}

/** Owns compiler services while keeping active-project selection independent of background work. */
export class BuildServices {
  constructor(options = {}) {
    this.options = options;
    this.services = new Map();
    this.subscriptions = new Map();
    this.activeId = null;
    this.events = new WorkbenchEvents();
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  get active() { return this.services.get(this.activeId) ?? null; }
  list() { return [...this.services.values()]; }
  get(id) { return this.services.get(id) ?? null; }

  register(project) {
    const id = requireIdentifier(project.id ?? project.path, 'Project id');
    if (this.services.has(id)) return this.services.get(id).configure(project);
    const service = new BuildService(project, this.options);
    this.services.set(id, service);
    this.subscriptions.set(id, service.subscribe(event => this.events.emit({ ...event, active: id === this.activeId })));
    if (this.activeId === null) this.activeId = id;
    this.events.emit({ type: 'registered', projectId: id, service });
    return service;
  }

  setActive(id) {
    if (id !== null && !this.services.has(id)) throw new Error(`Unknown build project '${id}'`);
    if (this.activeId === id) return this.active;
    this.activeId = id;
    this.events.emit({ type: 'selected', projectId: id, service: this.active });
    return this.active;
  }

  remove(id) {
    const service = this.services.get(id);
    if (!service) return;
    this.subscriptions.get(id)?.();
    this.subscriptions.delete(id);
    service.dispose();
    this.services.delete(id);
    this.options.diagnostics?.removeProject(id);
    if (this.activeId === id) this.activeId = this.services.keys().next().value ?? null;
    this.events.emit({ type: 'removed', projectId: id });
  }

  dispose() {
    for (const id of [...this.services.keys()]) this.remove(id);
    this.events.dispose();
  }
}
