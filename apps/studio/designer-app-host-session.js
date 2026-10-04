import {DesignerAppWorkerChannel} from './designer-app-host-channel.js';
import {DesignerAppWindow} from './designer-app-host-window.js';
import {DesignerAppControls} from './designer-app-host-controls.js';
import {DesignerAppSourceOwnership, appLaunchParameters} from './designer-app-host-source.js';
import {DesignerAppHostError, assertAppSignal, releaseAppResources} from './designer-app-host-errors.js';

/** One runtime generation. This object, its worker and its callbacks are never reused on restart. */
export class DesignerHostedApp {
  constructor(options) {
    Object.assign(this, options);
    this.identity = Object.freeze({sessionId: options.sessionId, generation: options.generation});
    this.generationSerial = options.generation;
    this.disposed = false;
    this.registered = false;
    this.runtimeSessionId = null;
    this.buffer = [];
    this.bufferedCommands = 0;
    this.layout = new Map();
    this.layoutPending = false;
    this.output = '';
    this.runtimeState = 'starting';
    this.controls = new DesignerAppControls(this);
    this.state = this.controls.state({uiActive: false, codeVersion: 0, windows: []});
    this.ownership = new DesignerAppSourceOwnership({
      workspaceId: this.workspaceId, sourceProjection: this.sourceProjection, compilationUris: this.compilationUris,
      getWorkspaceId: this.getWorkspaceId, sourceFiles: this.sourceFiles, compile: this.compile,
      options: {workspaceId: this.workspaceId, projectName: this.projectName, profile: this.profile, debug: this.debug, uri: this.uri},
      assertCurrent: () => this.assertCurrent()
    });
    this.requestChannel = (method, parameters, requestOptions) => this.request(method, parameters, requestOptions);
  }

  assertCurrent() {
    if (this.disposed || !this.isCurrent()) throw new DesignerAppHostError('The app was stopped or restarted', 'SFDA0002');
  }

  async start(result, signal) {
    assertAppSignal(signal);
    this.assertCurrent();
    const worker = this.createWorker();
    try {
      this.channel = new DesignerAppWorkerChannel(worker, {
        onEvent: event => this.receive(event), onFailure: error => this.onFailure(this, error), timeout: this.requestTimeout
      });
    } catch (error) {
      worker?.terminate?.();
      throw error;
    }
    const makeWindow = this.createWindow ?? (options => new DesignerAppWindow(options));
    this.view = makeWindow({
      ...this.windowOptions, identity: this.identity, projectName: this.projectName, position: this.position,
      onEvent: (id, event, payload) => this.input(id, event, payload), onLayout: changes => this.queueLayout(changes),
      onSelect: ids => this.selectFromTree(ids), onFront: () => this.onFront(this), onError: error => this.onError(error),
      controls: {
        pause: () => this.request('pause'), resume: () => this.request('resume', {mode: 'continue'}),
        restart: () => this.onRestart(this), stop: () => this.onStop(this)
      }
    });
    const parameters = appLaunchParameters(result, this);
    const launched = await this.channel.request('launch', parameters, {signal});
    assertAppSignal(signal);
    this.assertCurrent();
    if (!launched?.started || !Number.isSafeInteger(launched.sessionId) || launched.sessionId < 0) {
      throw new DesignerAppHostError('App worker returned an invalid launch identity', 'SFDA0005');
    }
    this.runtimeSessionId = launched.sessionId;
    for (const event of this.buffer.splice(0)) this.applyEvent(event);
    this.bufferedCommands = 0;
    return this;
  }

  descriptor() {
    return {
      ...this.identity, ...this.state, runtimeSessionId: this.runtimeSessionId, request: this.requestChannel,
      projectName: this.projectName, profile: this.profile, workspaceId: this.workspaceId, uri: this.uri,
      sourceProjection: this.ownership.projection, compilationUris: this.ownership.compilationUris,
      getState: () => this.disposed ? {...this.identity, uiActive: false, state: 'terminated'} : {...this.state, ...this.identity},
      selectVisual: (ids, identity) => {
        this.assertIdentity(identity);
        this.view.select(ids);
      },
      assertSourceOwnership: options => this.ownership.assertSourceOwnership(options),
      authorizeSourceChanges: receipt => this.ownership.authorizeSourceChanges(receipt),
      compile: options => {
        this.assertIdentity(options);
        return this.ownership.compile(options);
      }
    };
  }

  assertIdentity(identity = this.identity) {
    this.assertCurrent();
    if (identity.sessionId !== this.sessionId || identity.generation !== this.generation) {
      throw new DesignerAppHostError('The app command targets a different generation', 'SFDA0002');
    }
  }

  publish() {
    this.assertCurrent();
    this.sessions.register(this.descriptor());
    this.registered = true;
    this.view.show();
    this.flushLayout();
  }

  update() {
    if (this.registered && !this.disposed) this.sessions.update(this.sessionId, this.generation, {
      ...this.state, sourceProjection: this.ownership.projection, compilationUris: this.ownership.compilationUris
    });
  }

  async request(method, parameters = {}, {signal} = {}) {
    assertAppSignal(signal);
    this.assertCurrent();
    if (method === 'launch') throw new DesignerAppHostError('Restart this app through its host', 'SFDA0003');
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError('Invalid app request parameters');
    if (parameters.sessionId !== undefined && parameters.sessionId !== this.runtimeSessionId ||
        parameters.sessionGeneration !== undefined && parameters.sessionGeneration !== this.generation) {
      throw new DesignerAppHostError('The runtime request targets a different app generation', 'SFDA0002');
    }
    if (method === 'stop') return this.onStop(this);
    if (method === 'pause') return this.controls.pause(parameters, {signal});
    if (method === 'resume') return this.controls.resume(parameters, {signal});
    this.controls.assertInput(method);
    const compiled = method === 'hotReload' ? this.ownership.assertCodeUpdate(parameters) : null;
    let result;
    try {
      result = await this.send(method, parameters, {signal});
    } catch (error) {
      if (compiled && (signal?.aborted || ['SFDA0002', 'SFDA0004', 'SFDA0005'].includes(error.code))) this.ownership.uncertain = true;
      throw error;
    }
    this.assertCurrent();
    if (compiled) {
      this.ownership.acceptCodeUpdate(compiled);
      this.state.codeVersion = result?.codeVersion ?? this.state.codeVersion;
      this.update();
    }
    assertAppSignal(signal);
    return result;
  }

  async send(method, parameters = {}, {signal} = {}) {
    assertAppSignal(signal);
    this.assertCurrent();
    const result = await this.channel.request(method, {
      ...parameters, sessionId: this.runtimeSessionId, sessionGeneration: this.generation
    }, {signal});
    this.assertCurrent();
    if (method === 'uiAnimationMode') this.controls.manualAnimations = result?.manual ?? parameters.manual;
    assertAppSignal(signal);
    return result;
  }

  refreshState() {
    this.state = this.controls.state(this.state);
    this.view?.setState({...this.state, output: this.output});
    this.update();
    this.flushLayout();
  }

  receive(event) {
    if (this.disposed || !this.isCurrent()) return;
    if (this.runtimeSessionId !== null) {
      this.applyEvent(event);
      return;
    }
    if (event.event === 'ui') this.bufferedCommands += event.commands?.length ?? 0;
    if (this.buffer.length >= 128 || this.bufferedCommands > 40_000) {
      throw new DesignerAppHostError('App startup event limit exceeded', 'SFDA0014');
    }
    this.buffer.push(event);
  }

  applyEvent(event) {
    if (event.sessionId !== this.runtimeSessionId || this.disposed) return;
    if (event.event === 'ui') {
      if (!Array.isArray(event.commands) || event.commands.length > 20_000) throw new DesignerAppHostError('Invalid app UI batch', 'SFDA0014');
      this.view.apply(event.commands);
      this.state.windows = this.view.windows();
      this.state.windowTitle = this.state.windows[0]?.title ?? this.projectName;
      this.state.uiActive = this.state.windows.length > 0;
    } else if (event.event === 'state') {
      this.runtimeState = event.state;
      this.state = this.controls.state({...this.state, uiActive: !!event.uiActive, codeVersion: event.codeVersion ?? 0});
      if (typeof event.output === 'string') this.output = event.output.slice(-65_536);
      this.view.setState({...this.state, output: this.output});
      this.flushLayout();
    } else if (event.event === 'output') {
      this.output = (this.output + String(event.text ?? '')).slice(-65_536);
      this.view.setOutput(this.output);
    } else if (event.event === 'error') {
      this.view.error(new DesignerAppHostError(event.message || 'Managed app failed', event.code ?? 'SFDA0005'));
    }
    if (event.event === 'state' || event.event === 'ui') this.update();
  }

  input(id, event, payload) {
    if (this.disposed || !this.registered || this.controls.inputBlocked) return;
    this.request('uiEvent', {id, event, payload}).catch(error => {
      if (!this.disposed) this.view.error(error);
    });
  }

  queueLayout(changes) {
    if (this.disposed) return;
    if (!Array.isArray(changes) || changes.length > 20_000) throw new DesignerAppHostError('App layout batch limit exceeded', 'SFDA0014');
    for (const change of changes) this.layout.set(change.id, change);
    if (this.layout.size > 20_000) throw new DesignerAppHostError('App layout node limit exceeded', 'SFDA0014');
    this.flushLayout();
  }

  flushLayout() {
    if (this.disposed || !this.registered || this.layoutPending || !this.layout.size || this.controls.inputBlocked) return;
    this.layoutPending = true;
    queueMicrotask(async () => {
      if (this.disposed || this.controls.inputBlocked) {
        this.layoutPending = false;
        return;
      }
      const changes = [...this.layout.values()];
      this.layout.clear();
      try {
        await this.request('uiLayout', {changes});
      } catch (error) {
        if (!this.disposed) this.view.error(error);
      } finally {
        this.layoutPending = false;
        this.flushLayout();
      }
    });
  }

  selectFromTree(runtimeIds) {
    if (!this.registered || this.disposed || !this.state.uiActive) return;
    this.assertCurrent();
    this.sessions.select(this.sessionId, this.generation, runtimeIds, {fromTree: true, origin: this.view});
  }

  snapshot() {
    return {...this.identity, ...this.state, runtimeSessionId: this.runtimeSessionId, workspaceId: this.workspaceId,
      projectName: this.projectName, uri: this.uri, profile: this.profile, compilationUris: this.ownership.compilationUris};
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.buffer.length = 0;
    this.layout.clear();
    this.registered = false;
    releaseAppResources([
      () => this.ownership.dispose(), () => this.channel?.dispose(), () => this.view?.dispose(),
      () => this.sessions.remove(this.sessionId, this.generation)
    ]);
  }
}
