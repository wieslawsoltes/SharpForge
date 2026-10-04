import assert from 'node:assert/strict';
import {DesignerAppHost} from '../apps/studio/designer-app-host.js';

class RegistryStub {
  constructor() { this.entries = new Map(); this.selections = []; }
  get(id) { return this.entries.get(id) ?? null; }
  register(descriptor) {
    const previous = this.get(descriptor.sessionId);
    assert.ok(!previous || descriptor.generation > previous.generation || descriptor.request === previous.request);
    this.entries.set(descriptor.sessionId, {...descriptor, selection: []});
  }
  update(id, generation, changes) { Object.assign(this.resolve(id, generation, {active: false}), changes); }
  remove(id, generation) {
    if (this.get(id)?.generation !== generation) return false;
    return this.entries.delete(id);
  }
  resolve(id, generation, {active = true} = {}) {
    const app = this.get(id);
    assert.ok(app && app.generation === generation && (!active || app.uiActive), 'registry identity must match');
    const state = app.getState();
    assert.equal(state.sessionId, id);
    assert.equal(state.generation, generation);
    return app;
  }
  select(id, generation, ids, {fromTree = false, origin} = {}) {
    const app = this.resolve(id, generation);
    app.selection = [...ids];
    if (!fromTree) app.selectVisual(ids, {sessionId: id, generation, origin});
    this.selections.push({sessionId: id, generation, ids, origin});
  }
}

class RuntimeStub extends EventTarget {
  constructor(number, handler) {
    super();
    Object.assign(this, {number, handler, sent: [], terminated: false, state: 'waiting', codeVersion: 0});
    this.runtimeSessionId = 40 + number;
  }
  emit(data) { this.dispatchEvent(new MessageEvent('message', {data})); }
  event(event, data = {}) { this.emit({event, sessionId: this.runtimeSessionId, ...data}); }
  reportState() { this.event('state', {state: this.state, uiActive: true, codeVersion: this.codeVersion}); }
  postMessage(message) {
    this.sent.push(message);
    queueMicrotask(() => {
      if (this.terminated || this.handler?.(message, this)) return;
      const {id, method} = message;
      if (method === 'launch') {
        this.event('ui', {commands: [{op: 'create', id: 'window', properties: {Title: `App ${this.number}`}}, {op: 'activate', id: 'window'}]});
        this.reportState();
        this.emit({id, result: {started: true, sessionId: this.runtimeSessionId}});
      } else {
        if (method === 'pause' && ['running', 'waiting'].includes(this.state)) this.state = 'paused';
        if (method === 'resume' && this.state === 'paused') this.state = 'waiting';
        if (method === 'hotReload') this.codeVersion++;
        if (['pause', 'resume', 'hotReload'].includes(method)) this.reportState();
        this.emit({id, result: {worker: this.number, codeVersion: this.codeVersion, method}});
      }
    });
  }
  terminate() { this.terminated = true; }
}

class WindowStub {
  constructor(options) { this.options = options; this.nodes = new Map(); this.ids = []; this.selected = []; this.errors = []; }
  apply(commands) {
    for (const command of commands) {
      if (command.op === 'create') this.nodes.set(command.id, command);
      if (command.op === 'activate') this.ids.push(command.id);
    }
  }
  windows() { return this.ids.map(id => ({id, title: this.nodes.get(id).properties.Title})); }
  show() { this.shown = true; }
  setState(state) { this.state = state; }
  setOutput(text) { this.output = text; }
  select(ids) { this.selected = [...ids]; }
  error(error) { this.errors.push(error); this.options.onError(error); }
  dispose() { this.disposed = true; }
}

export function createAppHostFixture(options = {}) {
  const source = {files: [{uri: 'View.cs', text: 'class View {}'}], workspace: 'Demo:1'};
  const workers = [], windows = [], builds = [], errors = [];
  const sessions = new RegistryStub();
  const configuration = {
    build: {success: true, image: {entryPoint: 1}, assembly: new Uint8Array([1, 2]), compilationUris: ['View.cs']}, handler: null
  };
  const host = new DesignerAppHost({
    sessions, sourceFiles: () => source.files, workspaceId: () => source.workspace, projectName: () => 'Demo',
    compile: async request => {
      builds.push(request);
      return typeof configuration.build === 'function' ? configuration.build(request) : configuration.build;
    },
    createWorker: () => { const worker = new RuntimeStub(workers.length + 1, configuration.handler); workers.push(worker); return worker; },
    createWindow: request => { const view = new WindowStub(request); windows.push(view); return view; },
    onError: error => errors.push(error), ...options
  });
  return {host, source, workers, windows, builds, errors, sessions, configuration};
}
