import {DesignerAppSessions} from '../../packages/designer/src/index.js';

/** Bridges a legacy single-worker host into the same explicit registry used by multi-app hosts. */
export class StudioDesignerSessions {
  constructor({request, getState, projectName, compile, selectVisual, generation} = {}) {
    if (typeof request !== 'function' || typeof getState !== 'function') throw new TypeError('Runtime channel and state getter are required');
    this.registry = new DesignerAppSessions();
    this.request = request;
    this.getState = getState;
    this.projectName = projectName;
    this.compile = compile;
    this.selectVisual = selectVisual;
    this.generation = generation;
    this.current = null;
    this.channel = (method, parameters, options) => this.request(method, parameters, options);
  }

  refresh() {
    const state = this.getState();
    const nextGeneration = state ? this.generation?.(state) ?? state.generation ?? state.sessionId : null;
    if (this.current && (!state || state.sessionId !== this.current.sessionId || nextGeneration !== this.current.generation)) {
      this.registry.remove(this.current.sessionId, this.current.generation);
      this.current = null;
    }
    if (state?.sessionId === undefined || state?.sessionId === null) return;
    const identity = {sessionId: state.sessionId, generation: nextGeneration};
    this.registry.register({
      ...identity,
      request: this.channel,
      getState: () => {
        const current = this.getState();
        return current ? {...current, generation: this.generation?.(current) ?? current.generation ?? current.sessionId} : {
          sessionId: null, generation: -1, uiActive: false
        };
      },
      uiActive: !!state.uiActive,
      state: state.state,
      profile: state.profile,
      codeVersion: state.codeVersion ?? 0,
      projectName: typeof this.projectName === 'function' ? this.projectName() : this.projectName,
      windowTitle: state.windowTitle ?? state.title ?? 'WinUI Window',
      windows: state.windows,
      compile: this.compile,
      selectVisual: this.selectVisual
    });
    this.current = identity;
  }

  fromVisualTree(runtimeIds) {
    this.refresh();
    if (!this.current) return;
    const {sessionId, generation} = this.current;
    this.registry.select(sessionId, generation, runtimeIds, {fromTree: true});
  }

  dispose() { this.registry.dispose(); }
}
