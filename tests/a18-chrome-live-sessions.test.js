import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioDesignerSessions} from '../apps/studio/designer-live-sessions.js';
import {captureAppSources} from '../apps/studio/designer-app-host-source.js';

function bridgeFixture({compile, request, files} = {}) {
  const environment = {
    workspace: 'Workspace:1', files: files ?? [{uri: 'View.cs', text: 'class View {}', version: 1}],
    state: {sessionId: 'main', runtimeSessionId: 17, generation: 4, uiActive: true, state: 'paused', profile: 'cil', codeVersion: 0}
  };
  environment.state.workspaceId = environment.workspace;
  environment.state.sourceProjection = captureAppSources(environment.files);
  environment.state.compilationUris = ['View.cs'];
  const calls = [];
  const compiles = [];
  const selections = [];
  const result = {success: true, image: {entryPoint: 1}, assembly: new Uint8Array([1]), compilationUris: ['View.cs']};
  const bridge = new StudioDesignerSessions({
    getState: () => environment.state, workspaceId: () => environment.workspace, sourceFiles: () => environment.files,
    projectName: () => 'Project', selectVisual: (ids, identity) => selections.push({ids, identity}),
    compile: async options => { compiles.push(options); return compile ? compile(options) : result; },
    request: async (method, parameters, options) => {
      calls.push({method, parameters, options});
      if (request) return request(method, parameters, options);
      if (method === 'hotReload') return {codeVersion: ++environment.state.codeVersion};
      return {scene: {nodes: [], windows: []}, revision: 0};
    }
  });
  bridge.refresh();
  return {bridge, environment, app: bridge.registry.get('main'), calls, compiles, selections, result};
}

const identity = {sessionId: 'main', generation: 4};

test('the main app pins immutable launch sources and a stable workspace across ordinary refreshes', async () => {
  const {bridge, environment, app, calls, compiles} = bridgeFixture();
  assert.equal(app.workspaceId, 'Workspace:1');
  assert.ok(Object.isFrozen(app.sourceProjection) && Object.isFrozen(app.sourceProjection[0]));
  const original = app.sourceProjection;
  const channel = app.request;
  environment.files[0].text = 'unrelated work';
  environment.files[0].version++;
  bridge.refresh();
  assert.equal(app.sourceProjection, original);
  assert.equal(app.request, channel);
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0012'});
  await assert.rejects(app.compile(identity), {code: 'SFDA0012'});
  assert.equal(calls.length, 0);
  assert.equal(compiles.length, 0);
  environment.files[0].text = original[0].text;
  app.assertSourceOwnership({uris: ['View.cs']});
  environment.workspace = 'Workspace:2';
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0008'});
  bridge.dispose();
});

test('the launch projection is preferred over edited files at first registration', () => {
  const options = {request() {}, getState: () => ({sessionId: 0, generation: 0, uiActive: true,
    workspaceId: 0, sourceProjection: [{uri: 'View.cs', text: 'compiled'}], compilationUris: ['View.cs']}),
    workspaceId: 0, sourceFiles: () => [{uri: 'View.cs', text: 'edited'}]};
  const bridge = new StudioDesignerSessions(options);
  bridge.refresh();
  assert.equal(bridge.registry.get(0).sourceProjection[0].text, 'compiled');
  assert.throws(() => bridge.registry.get(0).assertSourceOwnership(), {code: 'SFDA0012'});
  bridge.dispose();
  assert.throws(() => new StudioDesignerSessions({...options, sourceFiles: undefined}), /supplied together/);
});

test('an authorized source receipt compiles the selected projection and accepts only that exact code artifact', async () => {
  const {bridge, environment, app, calls, compiles, result} = bridgeFixture();
  const before = captureAppSources(environment.files);
  app.assertSourceOwnership({uris: ['View.cs']});
  environment.files[0].text = 'class View { int edited; }';
  const authorized = app.authorizeSourceChanges({before, after: environment.files});
  assert.equal(app.sourceProjection[0].text, 'class View {}');
  assert.equal(await app.compile(identity), result);
  assert.equal(compiles[0].files, authorized);
  assert.equal(compiles[0].sourceProjection, authorized);
  assert.equal(compiles[0].sessionId, 'main');
  assert.equal(compiles[0].generation, 4);
  assert.equal(compiles[0].workspaceId, 'Workspace:1');
  assert.equal(compiles[0].reason, 'designer-app-hot-reload');
  await assert.rejects(app.request('hotReload', {image: {...result.image}}), {code: 'SFDA0012'});
  assert.equal(calls.length, 0);
  await app.request('hotReload', {image: result.image, expectedVersion: 0, sessionId: 17, sessionGeneration: 4});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parameters.sessionId, 17);
  assert.equal(calls[0].parameters.sessionGeneration, 4);
  assert.equal(app.sourceProjection, authorized);
  assert.equal(app.codeVersion, 1);
  app.assertSourceOwnership({uris: ['View.cs']});
  await assert.rejects(app.request('hotReload', {image: result.image}), {code: 'SFDA0012'});
  bridge.dispose();
});

test('workspace files outside the actual compilation remain protected even with a matching full-workspace receipt', () => {
  const {bridge, environment, app} = bridgeFixture({files: [
    {uri: 'View.cs', text: 'class View {}'}, {uri: 'OtherProject.cs', text: 'class Other {}'}
  ]});
  assert.deepEqual(app.compilationUris, ['View.cs']);
  assert.throws(() => app.assertSourceOwnership({uris: ['OtherProject.cs']}), {code: 'SFDA0012'});
  const before = captureAppSources(environment.files);
  environment.files[1].text = 'changed unrelated project';
  assert.throws(() => app.authorizeSourceChanges({before, after: environment.files}), {code: 'SFDA0012'});
  bridge.dispose();
});

test('a successful build without matching compilation membership is discarded before a main-worker request', async () => {
  const {bridge, app, result, calls} = bridgeFixture();
  result.compilationUris = [];
  await assert.rejects(app.compile(identity), {code: 'SFDA0012'});
  await assert.rejects(app.request('hotReload', {image: result.image}), {code: 'SFDA0012'});
  assert.deepEqual(calls, []);
  bridge.dispose();
});

test('wrong identities and restarted generations never dispatch through the replacement worker', async () => {
  const {bridge, environment, app, calls, compiles, selections} = bridgeFixture();
  await assert.rejects(app.request('designSnapshot', {sessionId: 999}), {code: 'SFDA0002'});
  await assert.rejects(app.request('designSnapshot', {sessionGeneration: 5}), {code: 'SFDA0002'});
  assert.throws(() => app.compile({sessionId: 'other', generation: 4}), {code: 'SFDA0002'});
  assert.throws(() => app.selectVisual(['node'], {sessionId: 'main', generation: 3}), {code: 'SFDA0002'});
  environment.state = {...environment.state, generation: 5, runtimeSessionId: 18};
  bridge.refresh();
  await assert.rejects(app.request('designSnapshot'), {code: 'SFDA0002'});
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0002'});
  assert.equal(calls.length + compiles.length + selections.length, 0);
  await bridge.registry.get('main').request('designSnapshot');
  assert.equal(calls[0].parameters.sessionId, 18);
  assert.equal(calls[0].parameters.sessionGeneration, 5);
  bridge.dispose();
});

test('source drift during a main-app compile discards its artifact before runtime dispatch', async () => {
  let entered, complete;
  const ready = new Promise(resolve => { entered = resolve; });
  const {bridge, environment, app, calls, result} = bridgeFixture({compile: options => {
    entered(options.signal);
    return new Promise(resolve => { complete = resolve; });
  }});
  const pending = app.compile(identity);
  await ready;
  environment.files[0].text = 'changed during compilation';
  complete(result);
  await assert.rejects(pending, {code: 'SFDA0012'});
  environment.files[0].text = 'class View {}';
  await assert.rejects(app.request('hotReload', {image: result.image}), {code: 'SFDA0012'});
  assert.equal(calls.length, 0);
  bridge.dispose();
});

test('restarting the main app cancels its pending compiler and invalidates saved callbacks', async () => {
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const {bridge, environment, app} = bridgeFixture({compile: options => {
    entered(options.signal);
    return new Promise(() => {});
  }});
  const pending = app.compile(identity);
  const signal = await ready;
  environment.state = {...environment.state, generation: 5};
  bridge.refresh();
  await assert.rejects(pending, {code: 'SFDA0002'});
  assert.equal(signal.aborted, true);
  bridge.dispose();
  assert.throws(() => bridge.refresh(), {code: 'SFDA0002'});
});

test('an interrupted dispatched code update requires restart instead of blessing an uncertain source projection', async () => {
  let entered, complete;
  const ready = new Promise(resolve => { entered = resolve; });
  const {bridge, app, result} = bridgeFixture({request: () => {
    entered();
    return new Promise(resolve => { complete = resolve; });
  }});
  await app.compile(identity);
  const controller = new AbortController();
  const pending = app.request('hotReload', {image: result.image}, {signal: controller.signal});
  await ready;
  controller.abort(new DOMException('Canceled code update', 'AbortError'));
  await assert.rejects(pending, {name: 'AbortError'});
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0011'});
  complete({codeVersion: 1});
  bridge.dispose();
});

test('the bridge remains usable for hosts without source ownership providers', async () => {
  const calls = [];
  const state = {sessionId: 0, generation: 1, uiActive: true};
  const bridge = new StudioDesignerSessions({request: async (method, parameters) => calls.push({method, parameters}), getState: () => state});
  bridge.refresh();
  const app = bridge.registry.get(0);
  assert.equal(app.assertSourceOwnership, undefined);
  await app.request('designSnapshot');
  assert.deepEqual(calls[0].parameters, {sessionId: 0, sessionGeneration: 1});
  bridge.dispose();
});

test('missing launch evidence cannot be replaced by current editor contents', async () => {
  const state = {sessionId: 0, generation: 1, uiActive: true};
  const calls = [];
  const bridge = new StudioDesignerSessions({request: async method => calls.push(method), getState: () => state,
    workspaceId: () => 'workspace', sourceFiles: () => [{uri: 'View.cs', text: 'current editor'}], compile: async () => ({success: true})});
  bridge.refresh();
  const app = bridge.registry.get(0);
  assert.equal(app.sourceProjection, undefined);
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0012'});
  assert.throws(() => app.compile({sessionId: 0, generation: 1}), {code: 'SFDA0012'});
  await assert.rejects(app.request('hotReload', {image: {}}), {code: 'SFDA0012'});
  await app.request('designSnapshot');
  assert.deepEqual(calls, ['designSnapshot']);
  state.workspaceId = 'workspace';
  state.sourceProjection = [{uri: 'View.cs', text: 'actual launch source'}];
  state.compilationUris = ['View.cs'];
  bridge.refresh();
  assert.equal(app.sourceProjection[0].text, 'actual launch source');
  assert.throws(() => app.assertSourceOwnership(), {code: 'SFDA0012'});
  bridge.dispose();
});
