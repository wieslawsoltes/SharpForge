import { WorkerClient } from './worker-client.js';
import { WorkbenchEvents, abortError, requireIdentifier, workbenchError } from './state-events.js';
import { defaultSessionSettings, sessionLaunchSettings, validateSessionSettings } from './session-settings.js';
import { setDebugSources } from '../debug-sources.js';

const liveStates = new Set(['created', 'launching', 'ready', 'running', 'waiting', 'paused']);
const controlMethods = new Set([
  'resume', 'stepBack', 'reverseContinue', 'runToCursor', 'runToInstruction', 'setNextStatement', 'hotReload', 'applyDesign'
]);

/** One application, worker generation and runtime serial form an inseparable identity. */
export class AppSession {
  constructor({ id, projectId, name = projectId, profileId = 'default', runtimeSettings, renderer = 'auto' }, options = {}) {
    this.id = requireIdentifier(id, 'Application id');
    this.projectId = requireIdentifier(projectId, 'Project id');
    this.profileId = requireIdentifier(profileId, 'Launch profile id');
    this.name = name;
    this.renderer = renderer;
    this.events = new WorkbenchEvents();
    this.output = options.output;
    this.channelId = this.output?.program(this);
    this.outputLength = 0;
    this.fallbackOutput = '';
    this.state = 'created';
    this.debug = null;
    this.debugging = true;
    setDebugSources(this, []);
    this.watchResults = new Map();
    this.watches = [];
    this.frameId = null;
    this.threadId = null;
    this.inspectedLocals = null;
    this.inspectedThreadFrames = null;
    this.inspectedThreadId = null;
    this.immediateHistory = [];
    this.lastManagedLaunch = null;
    this.runtimeSettings = validateSessionSettings(runtimeSettings ?? defaultSessionSettings());
    this.activeRuntimeSettings = null;
    this.boundBreakpoints = new Map();
    this.launchEpoch = 0;
    this.launchBusy = false;
    this.runtimeSession = null;
    this.expectedRuntimeSession = 1;
    this.lastLaunch = null;
    this.pendingControl = null;
    this.controlBusy = false;
    this.hotEdit = false;
    this.watchEpoch = 0;
    this.detached = false;
    this.disposed = false;
    this.ended = false;
    this.worker = new WorkerClient(options.runtimeUrl ?? new URL('../runtime.worker.js', import.meta.url), {
      kind: 'runtime',
      workerFactory: options.workerFactory,
      name: `runtime:${id}`,
      onEvent: (event, envelope) => this.receive(event, envelope.generation),
      onError: error => {
        this.state = 'faulted';
        this.debug = { ...this.debug, event: 'state', sessionId: this.runtimeSession, state: 'faulted', uiActive: false };
        this.ended = true;
        this.launchBusy = false;
        this.emit('error', { error });
        this.emit('state', { event: this.debug });
        this.emit('ended');
        options.onError?.(error);
      }
    });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  get identity() { return `${this.id}:${this.worker.generation}:${this.runtimeSession ?? 0}`; }
  get live() { return !this.disposed && (liveStates.has(this.state) || this.debug?.uiActive === true); }
  get readOnly() { return this.live && this.state !== 'created' && !this.hotEdit; }
  get programOutput() { return this.output ? this.output.text(this.channelId) : this.fallbackOutput; }
  set programOutput(value) { this.replaceOutput(value); }

  emit(type, values = {}) {
    this.events.emit({
      ...values, type, session: this, appId: this.id, projectId: this.projectId,
      generation: this.worker?.generation ?? 0, runtimeSession: this.runtimeSession, identity: this.worker ? this.identity : null
    });
  }

  appendOutput(text) {
    if (typeof text !== 'string') throw new TypeError('Runtime output must be text');
    this.outputLength += text.length;
    if (this.output) this.output.append(this.channelId, text, { projectId: this.projectId, sessionId: this.id });
    else this.fallbackOutput = (this.fallbackOutput + text).slice(-2_000_000);
  }

  replaceOutput(text) {
    if (typeof text !== 'string') throw new TypeError('Runtime output must be text');
    this.output?.clear(this.channelId);
    this.fallbackOutput = '';
    this.outputLength = 0;
    this.appendOutput(text);
  }

  synchronizeOutput(text) {
    if (typeof text !== 'string') return;
    if (text.length > this.outputLength) this.appendOutput(text.slice(this.outputLength));
    else if (text.length < this.outputLength || !text.endsWith(this.programOutput)) this.replaceOutput(text);
  }

  receive(event, generation) {
    if (this.disposed || generation !== this.worker.generation) return false;
    const serial = event.sessionId;
    if (serial !== undefined) {
      if (!Number.isSafeInteger(serial) || serial < this.expectedRuntimeSession) return false;
      if (this.runtimeSession !== null && serial !== this.runtimeSession && !this.launchBusy) return false;
      this.runtimeSession = serial;
      this.expectedRuntimeSession = serial;
    }
    if (event.event === 'loaded') {
      setDebugSources(this, event.sources);
      this.immediateHistory = [];
      this.emit('loaded', { event });
    } else if (event.event === 'output') {
      this.appendOutput(event.text);
      this.emit('output', { event, text: event.text });
    } else if (event.event === 'state') this.receiveState(event);
    else if (event.event === 'ui') this.emit('ui', { event, commands: event.commands ?? [] });
    else if (event.event === 'error' || event.event === 'runtimeerror') {
      this.emit('error', { event, error: workbenchError('RUNTIME_ERROR', event.message ?? 'Application runtime error') });
    }
    return true;
  }

  receiveState(event) {
    const previous = this.debug;
    this.debug = { ...event, appId: this.id, identity: this.identity, generation: this.worker.generation };
    this.state = event.state;
    this.synchronizeOutput(event.output);
    this.threadId = this.threadId ?? event.threadId ?? null;
    if (event.state === 'paused' && (previous?.state !== 'paused' || previous?.point?.id !== event.point?.id)) {
      this.frameId = event.frames?.[0]?.id ?? null;
      this.inspectedLocals = null;
      this.inspectedThreadFrames = null;
      this.inspectedThreadId = null;
      this.watchEpoch++;
    }
    this.boundBreakpoints = new Map((event.breakpoints ?? []).map((breakpoint, index) => [breakpoint.id ?? index, { ...breakpoint }]));
    this.emit('state', { event: this.debug, previous });
    if (!this.live && !this.ended) {
      this.ended = true;
      this.watchResults.clear();
      this.emit('ended', { event: this.debug });
    }
  }

  async launch(params, { signal } = {}) {
    if (this.disposed) throw workbenchError('SESSION_DISPOSED', 'Application session is disposed');
    if (this.launchBusy) throw workbenchError('SESSION_BUSY', 'Application launch is already in progress');
    if (signal?.aborted) throw abortError(signal.reason);
    const epoch = ++this.launchEpoch;
    this.launchBusy = true;
    this.ended = false;
    this.state = 'launching';
    this.debugging = params.debug !== false;
    this.detached = false;
    this.expectedRuntimeSession = (this.runtimeSession ?? 0) + 1;
    const settings = sessionLaunchSettings(this.runtimeSettings);
    const launch = { ...settings, ...params, network: { ...settings.network, ...params.network }, compute: { ...settings.compute, ...params.compute } };
    this.activeRuntimeSettings = structuredClone({ network: launch.network, compute: launch.compute });
    this.lastLaunch = launch;
    this.replaceOutput('');
    this.watchResults.clear();
    this.frameId = null;
    this.threadId = null;
    setDebugSources(this, []);
    this.emit('starting');
    const abort = () => {
      this.worker.restart(abortError(signal.reason));
      this.runtimeSession = null;
      this.expectedRuntimeSession = 1;
      this.launchEpoch++;
      this.launchBusy = false;
      this.state = 'stopped';
      this.debug = null;
      this.ended = true;
      this.emit('state', { event: null });
      this.emit('ended');
    };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await this.worker.request('launch', launch, { signal });
      if (epoch !== this.launchEpoch) throw abortError('Application launch was superseded');
      this.runtimeSession = result.sessionId;
      this.expectedRuntimeSession = result.sessionId;
      this.emit('started', { result });
      return result;
    } catch (error) {
      if (epoch === this.launchEpoch) {
        this.state = 'faulted';
        this.debug = { ...this.debug, event: 'state', sessionId: this.runtimeSession, state: 'faulted', uiActive: false };
        this.ended = true;
        this.emit('error', { error });
        this.emit('state', { event: this.debug });
        this.emit('ended');
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (epoch === this.launchEpoch) this.launchBusy = false;
    }
  }

  request(method, params = {}, options = {}) {
    if (method === 'launch') return this.launch(params, options);
    if (this.disposed) return Promise.reject(workbenchError('SESSION_DISPOSED', 'Application session is disposed'));
    if (params.identity !== undefined && params.identity !== this.identity) {
      return Promise.reject(workbenchError('SESSION_STALE', 'Application generation changed'));
    }
    if (params.appId !== undefined && params.appId !== this.id) return Promise.reject(workbenchError('SESSION_STALE', 'Wrong application id'));
    if (params.sessionId !== undefined && params.sessionId !== this.runtimeSession) {
      return Promise.reject(workbenchError('SESSION_STALE', 'Runtime session changed'));
    }
    if (controlMethods.has(method) && this.pendingControl) {
      if (this.pendingControl.method === method) return this.pendingControl.promise;
      return Promise.reject(workbenchError('SESSION_BUSY', 'Wait for the current debug operation to complete'));
    }
    const { identity: ignoredIdentity, appId: ignoredApp, ...wire } = params;
    const identity = this.identity;
    const promise = this.worker.request(method, { ...wire, sessionId: this.runtimeSession ?? undefined }, options).then(result => {
      if (this.identity !== identity) throw workbenchError('SESSION_STALE', 'Application changed while the request was running');
      return result;
    });
    if (!controlMethods.has(method)) return promise;
    this.controlBusy = true;
    const pending = { method, promise: null };
    pending.promise = promise.finally(() => {
      if (this.pendingControl !== pending) return;
      this.pendingControl = null;
      this.controlBusy = false;
      this.emit('control');
    });
    this.pendingControl = pending;
    this.emit('control');
    return pending.promise;
  }

  async stop() {
    if (this.disposed || this.state === 'stopped') return;
    this.launchEpoch++;
    if (this.launchBusy || this.worker.failed) {
      this.worker.restart(abortError('Application stopped'));
      this.runtimeSession = null;
      this.expectedRuntimeSession = 1;
    }
    else if (this.runtimeSession !== null) await this.request('stop');
    this.launchBusy = false;
    this.hotEdit = false;
    this.state = 'stopped';
    if (this.debug) this.debug = { ...this.debug, state: 'terminated', uiActive: false };
    if (!this.ended) { this.ended = true; this.emit('ended'); }
    this.emit('state', { event: this.debug });
  }

  async restart(options = {}) {
    if (!this.lastLaunch) throw workbenchError('SESSION_NOT_LAUNCHED', 'This application has not been launched');
    const launch = { ...this.lastLaunch, ...sessionLaunchSettings(this.runtimeSettings), ...options };
    this.worker.restart(abortError('Application restarted'));
    this.runtimeSession = null;
    this.expectedRuntimeSession = 1;
    this.pendingControl = null;
    this.controlBusy = false;
    this.launchBusy = false;
    this.debug = null;
    return this.launch(launch);
  }

  async detach() {
    if (!this.debugging) return;
    const identity = this.identity;
    await this.request('breakpointsEnabled', { enabled: false, identity });
    await this.request('exceptionBreak', { mode: 'none', rules: [], identity });
    if (this.state === 'paused') await this.request('resume', { mode: 'continue', identity });
    this.debugging = false;
    this.detached = true;
    this.emit('detached');
  }

  resources() {
    return {
      worker: this.disposed ? 'disposed' : this.worker.failed ? 'failed' : 'running',
      generation: this.worker.generation,
      pendingRequests: this.worker.pending.size,
      heapBytes: this.debug?.stats?.heap?.liveBytes ?? null,
      heapObjects: this.debug?.stats?.heap?.liveObjects ?? null,
      engine: this.debug?.profile ?? (this.lastLaunch?.managedIL ? 'managed-il' : 'source-vm')
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.launchEpoch++;
    this.worker.dispose();
    this.state = 'disposed';
    this.ended = true;
    this.emit('disposed');
    this.events.dispose();
  }
}
