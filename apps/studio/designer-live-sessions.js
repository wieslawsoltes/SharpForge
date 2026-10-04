import {DesignerAppSessions} from '../../packages/designer/src/index.js';
import {DesignerAppSourceOwnership, appWorkspaceIdentity, captureAppSources, captureAppCompilationUris} from './designer-app-host-source.js';
import {DesignerAppHostError, assertAppSignal, awaitAppOperation} from './designer-app-host-errors.js';

/** Bridge the main worker into explicit app generations and optionally pin its launch source projection. */
export class StudioDesignerSessions {
  constructor({request, getState, projectName, compile, selectVisual, generation, workspaceId, sourceFiles} = {}) {
    if (typeof request !== 'function' || typeof getState !== 'function') throw new TypeError('Runtime channel and state getter are required');
    if ((workspaceId === undefined) !== (sourceFiles === undefined) || sourceFiles !== undefined && typeof sourceFiles !== 'function') {
      throw new TypeError('Workspace identity and source files must be supplied together');
    }
    Object.assign(this, {request, getState, projectName, compile, selectVisual, generation, workspaceId, sourceFiles});
    this.registry = new DesignerAppSessions();
    this.current = null;
    this.disposed = false;
  }

  state() {
    const state = this.getState();
    return state ? {...state, generation: this.generation?.(state) ?? state.generation ?? state.sessionId} : null;
  }

  assertCurrent(current, identity = current) {
    const state = this.state();
    if (this.disposed || current !== this.current || !state || state.sessionId !== current.sessionId ||
        state.generation !== current.generation || (state.runtimeSessionId ?? state.sessionId) !== current.runtimeSessionId ||
        identity.sessionId !== current.sessionId || identity.generation !== current.generation) {
      throw new DesignerAppHostError('The main app was stopped or restarted. No command was sent to its replacement.', 'SFDA0002');
    }
  }

  create(state) {
    const current = {sessionId: state.sessionId, generation: state.generation, runtimeSessionId: state.runtimeSessionId ?? state.sessionId};
    current.request = (method, parameters, options) => this.dispatch(current, method, parameters, options);
    current.projectName = typeof this.projectName === 'function' ? this.projectName() : this.projectName;
    this.captureOwnership(current, state);
    return current;
  }

  captureOwnership(current, state) {
    if (!this.sourceFiles || current.ownership || state.sourceProjection === undefined || state.workspaceId === undefined) return;
    const getWorkspaceId = () => typeof this.workspaceId === 'function' ? this.workspaceId() : this.workspaceId;
    const workspaceId = appWorkspaceIdentity(state.workspaceId);
    const sourceProjection = captureAppSources(state.sourceProjection);
    const compilationUris = captureAppCompilationUris(state.compilationUris, sourceProjection);
    current.ownership = new DesignerAppSourceOwnership({
      workspaceId, sourceProjection, compilationUris,
      getWorkspaceId, sourceFiles: this.sourceFiles, compile: this.compile,
      options: {sessionId: current.sessionId, generation: current.generation, workspaceId,
        projectName: current.projectName, profile: state.profile, debug: state.debug, uri: state.uri, compilationUris},
      assertCurrent: () => this.assertCurrent(current)
    });
  }

  sourceOwnership(current) {
    this.assertCurrent(current);
    if (!current.ownership) {
      throw new DesignerAppHostError('This app has no captured launch sources. Restart it before applying source or Hot Reload.', 'SFDA0012');
    }
    return current.ownership;
  }

  descriptor(current, state) {
    const ownership = current.ownership;
    return {
      sessionId: current.sessionId, generation: current.generation, runtimeSessionId: current.runtimeSessionId,
      request: current.request, getState: () => this.state() ?? {sessionId: null, generation: -1, uiActive: false},
      uiActive: !!state.uiActive, state: state.state, profile: state.profile, codeVersion: state.codeVersion ?? 0,
      projectName: current.projectName, windowTitle: state.windowTitle ?? state.title ?? 'WinUI Window', windows: state.windows,
      workspaceId: ownership?.workspaceId, sourceProjection: ownership?.projection, compilationUris: ownership?.compilationUris, uri: state.uri,
      compile: typeof this.compile === 'function' ? options => {
        this.assertCurrent(current, options);
        return this.sourceFiles ? this.sourceOwnership(current).compile(options) : this.compile(options);
      } : undefined,
      assertSourceOwnership: this.sourceFiles ? options => this.sourceOwnership(current).assertSourceOwnership(options) : undefined,
      authorizeSourceChanges: this.sourceFiles ? receipt => this.sourceOwnership(current).authorizeSourceChanges(receipt) : undefined,
      selectVisual: this.selectVisual ? (ids, identity) => {
        this.assertCurrent(current, identity);
        this.selectVisual(ids, identity);
      } : undefined
    };
  }

  /** Register once per generation. Routine UI refreshes never bless unrelated workspace edits. */
  refresh() {
    if (this.disposed) throw new DesignerAppHostError('The main app session bridge is disposed', 'SFDA0002');
    const state = this.state();
    if (this.current && (!state || state.sessionId !== this.current.sessionId || state.generation !== this.current.generation)) {
      this.current.ownership?.dispose();
      this.registry.remove(this.current.sessionId, this.current.generation);
      this.current = null;
    }
    if (state?.sessionId === undefined || state?.sessionId === null) return;
    this.current ??= this.create(state);
    this.captureOwnership(this.current, state);
    this.registry.register(this.descriptor(this.current, state));
  }

  async dispatch(current, method, parameters = {}, {signal} = {}) {
    assertAppSignal(signal);
    this.assertCurrent(current);
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError('Invalid app request parameters');
    if (parameters.sessionId !== undefined && parameters.sessionId !== current.runtimeSessionId ||
        parameters.sessionGeneration !== undefined && parameters.sessionGeneration !== current.generation) {
      throw new DesignerAppHostError('The runtime request targets a different app generation', 'SFDA0002');
    }
    const ownership = method === 'hotReload' && this.sourceFiles ? this.sourceOwnership(current) : current.ownership;
    const compiled = method === 'hotReload' ? ownership?.assertCodeUpdate(parameters) : null;
    let dispatched = false;
    try {
      const result = await awaitAppOperation(() => {
        dispatched = true;
        return this.request(method, {...parameters, sessionId: current.runtimeSessionId, sessionGeneration: current.generation}, {signal});
      }, {signal});
      this.assertCurrent(current);
      if (compiled) {
        ownership.acceptCodeUpdate(compiled);
        this.registry.update(current.sessionId, current.generation, {
          sourceProjection: ownership.projection, compilationUris: ownership.compilationUris,
          ...(result?.codeVersion !== undefined ? {codeVersion: result.codeVersion} : {})
        });
      }
      assertAppSignal(signal);
      return result;
    } catch (error) {
      if (compiled && dispatched && (signal?.aborted || ['SFDA0002', 'SFDA0004', 'SFDA0005'].includes(error.code))) {
        ownership.uncertain = true;
      }
      throw error;
    }
  }

  fromVisualTree(runtimeIds) {
    this.refresh();
    if (!this.current) return;
    const {sessionId, generation} = this.current;
    this.registry.select(sessionId, generation, runtimeIds, {fromTree: true});
  }

  dispose() {
    this.disposed = true;
    this.current?.ownership?.dispose();
    this.current = null;
    this.registry.dispose();
  }
}
