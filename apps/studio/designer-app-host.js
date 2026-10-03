import {DesignerHostedApp} from './designer-app-host-session.js';
import {DesignerAppHostError, assertAppSignal, awaitAppOperation, releaseAppResources} from './designer-app-host-errors.js';
import {appProfile, appWorkspaceIdentity, captureAppSources, sameAppSources,
  captureAppCompilationUris, appLaunchParameters} from './designer-app-host-source.js';

export {DesignerAppHostError} from './designer-app-host-errors.js';

/** Own up to eight independently compiled worker applications; the main Studio debugger is never consulted. */
export class DesignerAppHost {
  constructor({sessions, compile, sourceFiles, projectName, workspaceId, createWorker, createWindow, runtimeOptions = () => ({}),
    windowOptions = {}, onError = () => {}, onChange = () => {}, limit = 8, requestTimeout = 30_000, idPrefix = 'designer-app'} = {}) {
    if (!sessions?.register || !sessions?.remove || !sessions?.update || !sessions?.get) throw new TypeError('An app session registry is required');
    if (typeof compile !== 'function' || typeof sourceFiles !== 'function' || typeof workspaceId !== 'function') {
      throw new TypeError('App compilation, sources and workspace identity providers are required');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new RangeError('An app host supports one to eight applications');
    if (!Number.isFinite(requestTimeout) || requestTimeout < 1 || requestTimeout > 60_000) throw new RangeError('Invalid app request deadline');
    if (typeof idPrefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(idPrefix)) throw new TypeError('Invalid app identity prefix');
    Object.assign(this, {sessions, compile, sourceFiles, projectName, workspaceId, createWindow, runtimeOptions,
      windowOptions, onError, onChange, limit, requestTimeout, idPrefix});
    this.createWorker = createWorker ?? (() => new Worker(new URL('./runtime.worker.js', import.meta.url), {type: 'module'}));
    this.apps = new Map();
    this.operations = new Map();
    this.serial = 0;
    this.disposed = false;
  }

  assertOpen() {
    if (this.disposed) throw new DesignerAppHostError('The app host is disposed', 'SFDA0002');
  }

  nextId() {
    let id;
    do { id = `${this.idPrefix}-${++this.serial}`; } while (this.sessions.get(id) || this.operations.has(id));
    return id;
  }

  resolve(sessionId, generation) {
    this.assertOpen();
    const app = this.apps.get(sessionId);
    if (!app || generation !== undefined && app.generation !== generation) {
      throw new DesignerAppHostError('The app was stopped or restarted', 'SFDA0002');
    }
    return app;
  }

  /** Compile the current workspace exactly once before creating any worker or window. */
  async launch({uri, debug = false, profile = 'cil', signal} = {}) {
    this.assertOpen();
    const pending = [...this.operations.values()].filter(operation => !operation.previous).length;
    if (this.apps.size + pending >= this.limit) {
      throw new DesignerAppHostError(`Stop an app before starting another. The limit is ${this.limit}.`, 'SFDA0006');
    }
    return this.replace({sessionId: this.nextId(), generation: 1, uri, debug: !!debug, profile: appProfile(profile), signal});
  }

  /** A failed replacement leaves the previous runtime alive. Every attempt reserves a new generation. */
  async restart(sessionId, {generation, signal} = {}) {
    const previous = this.resolve(sessionId, generation);
    if (this.operations.has(sessionId)) throw new DesignerAppHostError('This app is already restarting', 'SFDA0013');
    if (this.workspaceId() !== previous.workspaceId) throw new DesignerAppHostError('This app belongs to another workspace', 'SFDA0008');
    return this.replace({sessionId, generation: ++previous.generationSerial, uri: previous.uri, debug: previous.debug,
      profile: previous.profile, previous, signal});
  }

  operation(options) {
    assertAppSignal(options.signal);
    if (options.uri !== undefined && (typeof options.uri !== 'string' || !options.uri || options.uri.length > 4096)) {
      throw new TypeError('Invalid app document URI');
    }
    const controller = new AbortController();
    const operation = {...options, controller, candidate: null};
    const canceled = () => controller.abort(options.signal.reason);
    options.signal?.addEventListener('abort', canceled, {once: true});
    operation.release = () => options.signal?.removeEventListener('abort', canceled);
    this.operations.set(options.sessionId, operation);
    return operation;
  }

  assertOperation(operation) {
    this.assertOpen();
    assertAppSignal(operation.controller.signal);
    if (this.operations.get(operation.sessionId) !== operation) throw new DesignerAppHostError('App launch was superseded', 'SFDA0002');
  }

  async replace(options) {
    const operation = this.operation(options);
    try {
      const workspaceId = appWorkspaceIdentity(this.workspaceId());
      const sourceProjection = captureAppSources(this.sourceFiles());
      const name = typeof this.projectName === 'function' ? this.projectName() : this.projectName;
      const projectName = String(name || 'SharpForge App').slice(0, 256);
      const launchOptions = {...options, workspaceId, sourceProjection, projectName};
      const result = await awaitAppOperation(() => this.compile({
        reason: 'designer-app-launch', uri: options.uri, profile: options.profile, debug: options.debug,
        workspaceId, projectName, sourceProjection, files: sourceProjection, signal: operation.controller.signal
      }), {signal: operation.controller.signal});
      this.assertOperation(operation);
      if (this.workspaceId() !== workspaceId || !sameAppSources(sourceProjection, captureAppSources(this.sourceFiles()))) {
        throw new DesignerAppHostError('Workspace or sources changed during app compilation; the result was discarded', 'SFDA0012');
      }
      appLaunchParameters(result, launchOptions);
      launchOptions.compilationUris = captureAppCompilationUris(result.compilationUris, sourceProjection);
      const candidate = this.createCandidate(operation, launchOptions);
      operation.candidate = candidate;
      await candidate.start(result, operation.controller.signal);
      this.assertOperation(operation);
      if (this.workspaceId() !== workspaceId || !sameAppSources(sourceProjection, captureAppSources(this.sourceFiles()))) {
        throw new DesignerAppHostError('Workspace or sources changed while the app started', 'SFDA0012');
      }
      return this.publish(operation);
    } catch (error) {
      operation.controller.abort(error);
      operation.candidate?.dispose();
      throw error;
    } finally {
      operation.release();
      if (this.operations.get(options.sessionId) === operation) this.operations.delete(options.sessionId);
    }
  }

  createCandidate(operation, options) {
    const candidate = new DesignerHostedApp({
      sessionId: options.sessionId, generation: options.generation, uri: options.uri, profile: options.profile, debug: options.debug,
      workspaceId: options.workspaceId, sourceProjection: options.sourceProjection, projectName: options.projectName,
      compilationUris: options.compilationUris,
      sessions: this.sessions, compile: this.compile, sourceFiles: this.sourceFiles, getWorkspaceId: this.workspaceId,
      createWorker: this.createWorker, createWindow: this.createWindow, windowOptions: this.windowOptions, position: this.serial - 1,
      runtimeOptions: structuredClone(typeof this.runtimeOptions === 'function' ? this.runtimeOptions(options) : this.runtimeOptions),
      requestTimeout: this.requestTimeout, onError: this.onError,
      isCurrent: () => this.apps.get(options.sessionId) === candidate || this.operations.get(options.sessionId)?.candidate === candidate,
      onStop: app => this.stop(app.sessionId, {generation: app.generation}),
      onRestart: app => this.restart(app.sessionId, {generation: app.generation}),
      onFailure: (app, error) => this.failed(app, error), onFront: app => this.front(app)
    });
    return candidate;
  }

  publish(operation) {
    const {candidate, previous} = operation;
    this.apps.set(candidate.sessionId, candidate);
    try {
      candidate.publish();
    } catch (error) {
      candidate.dispose();
      this.apps.delete(candidate.sessionId);
      if (previous) {
        this.apps.set(previous.sessionId, previous);
        previous.publish();
      }
      throw error;
    }
    previous?.dispose();
    this.onChange(this.list());
    return candidate.snapshot();
  }

  failed(app, error) {
    const operation = this.operations.get(app.sessionId);
    if (operation?.candidate === app) operation.controller.abort(error);
    if (this.apps.get(app.sessionId) === app) this.stop(app.sessionId, {generation: app.generation});
    else app.dispose();
    this.onError(error);
  }

  front(app) {
    if (this.apps.get(app.sessionId) !== app || !app.view?.element) return;
    let layer = 600;
    for (const other of this.apps.values()) {
      if (other.view?.element) other.view.element.style.zIndex = String(other === app ? 608 : layer++);
    }
  }

  pause(sessionId, options = {}) { return this.resolve(sessionId, options.generation).request('pause', {}, options); }
  resume(sessionId, options = {}) { return this.resolve(sessionId, options.generation).request('resume', {mode: 'continue'}, options); }
  list() { return [...this.apps.values()].map(app => app.snapshot()); }

  stop(sessionId, {generation} = {}) {
    const app = this.apps.get(sessionId);
    const operation = this.operations.get(sessionId);
    if (generation !== undefined && app?.generation !== generation && operation?.generation !== generation) return false;
    if (!app && !operation) return false;
    const reason = new DesignerAppHostError('App stopped', 'SFDA0002');
    if (operation) {
      this.operations.delete(sessionId);
      operation.controller.abort(reason);
    }
    this.apps.delete(sessionId);
    releaseAppResources([
      () => operation?.candidate?.dispose(), () => app?.dispose(), () => this.onChange(this.list())
    ]);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const identities = new Set([...this.apps.keys(), ...this.operations.keys()]);
    releaseAppResources([...identities].map(sessionId => () => this.stop(sessionId)));
  }
}
