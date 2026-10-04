import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectSystem} from '@sharpforge/project-system';
import {EditorModel} from '@sharpforge/editor';
import {Workspace} from '@sharpforge/workspace';
import {LanguageService} from '@sharpforge/language';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {createWorkbenchServices} from '../apps/studio/workbench/sessions.js';
import {StudioProjects} from '../apps/studio/workbench/studio-projects.js';
import {CallHierarchyModel} from '../apps/studio/workbench/tools/call-hierarchy.js';
import {WorkbenchShell} from '../apps/studio/workbench/shell.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {registerEditorLanguageHandlers} from '../apps/studio/workers/editor-language.js';
import {deferred, fakeWorkers} from './a19-session-fixtures.js';

const ALPHA = 'Alpha/Alpha.csproj';
const BETA = 'Beta/Beta.csproj';
const URI = 'Beta/Program.cs';
const beta = 'class Beta { public static int Root(){return Child();} public static int Child(){return 1;} ' +
  'public static int Caller(){return Root();} }';

function fixture(t) {
  const project = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Library</OutputType></PropertyGroup></Project>';
  const records = [
    {path: 'Apps.slnx', text: '<Solution><Project Path="Alpha/Alpha.csproj"/><Project Path="Beta/Beta.csproj"/></Solution>'},
    {path: ALPHA, text: project}, {path: BETA, text: project},
    {path: 'Alpha/Program.cs', text: 'class Alpha { public static int Unrelated(){return 0;} }'},
    {path: URI, text: beta}
  ];
  const projectSystem = new ProjectSystem(records);
  projectSystem.load('Apps.slnx');
  const contexts = new Map();
  const control = {};
  const workers = fakeWorkers(async (message, worker) => {
    let context = contexts.get(worker);
    if (!context) {
      const workspace = new Workspace();
      const language = new LanguageService(workspace);
      const protocol = createWorkerProtocol('compiler');
      registerEditorLanguageHandlers(protocol, {workspace, language, refactoring: new RefactoringEngine(workspace, language)});
      contexts.set(worker, context = {workspace, protocol});
    }
    const {workspace, protocol} = context;
    const available = new Set(message.params.files.map(file => file.uri));
    for (const uri of workspace.documents.keys()) if (!available.has(uri)) workspace.remove(uri);
    for (const file of message.params.files) workspace.update(file.uri, file.text, file.version);
    workspace.compilationOptions = message.params.compilationOptions;
    workspace.result = null;
    const result = protocol.dispatch(message.method, message.params);
    await control.beforeReply?.(message, result);
    return result;
  });
  let projects;
  const services = createWorkbenchServices({workerFactory: workers.factory,
    records: records.filter(file => file.path.endsWith('.cs')).map(file => ({uri: file.path, text: file.text, version: 1})),
    createModel: record => new EditorModel(record.text, {uri: record.uri, version: record.version}),
    getProjectSnapshot: id => projects.snapshot(id)});
  const state = {projectSystem, files: services.documents.files, startupProject: ALPHA, active: 'Alpha/Program.cs',
    name: 'Apps', langVersion: '14', configuration: 'Debug', workspaceEpoch: 1, nativeMode: false};
  projects = new StudioProjects(services, {state: () => state});
  projects.sync();
  const requests = [];
  const model = new CallHierarchyModel({documents: services.documents, request: (method, parameters, options) => {
    requests.push({method, parameters, signal: options?.signal});
    return projects.request(method, parameters, options);
  }});
  t.after(() => {
    model.dispose();
    services.dispose();
    for (const context of contexts.values()) context.protocol.dispose();
  });
  return {model, services, projects, state, requests, workers, control};
}

test('non-startup URI routes every lazy expansion and navigation through its actual compiler owner', async t => {
  const {model, services, state, requests, workers} = fixture(t);
  const [root] = await model.prepare({uri: URI, offset: beta.indexOf('Root')});
  assert.equal(root.projectId, BETA);
  assert.equal(root.item.name, 'Root');
  assert.equal(requests.length, 1, 'preparing a root does not eagerly query calls');
  const outgoing = root.children.find(node => node.direction === 'outgoing');
  await model.expand(outgoing);
  assert.deepEqual(outgoing.children.map(node => node.item.name), ['Child']);
  const child = outgoing.children[0];
  assert.deepEqual([model.location(child).uri, model.location(child).projectId, model.location(child).version], [URI, BETA, 1]);
  assert.deepEqual([model.location(child, child.ranges[0]).uri, model.location(child, child.ranges[0]).projectId], [URI, BETA]);
  state.startupProject = BETA;
  state.active = URI;
  await model.expand(root.children.find(node => node.direction === 'incoming'));
  state.startupProject = ALPHA;
  state.active = 'Alpha/Program.cs';
  await model.expand(child.children.find(node => node.direction === 'incoming'));
  assert.deepEqual(child.children[0].children.map(node => node.item.name), ['Root']);
  for (const request of requests.slice(1)) {
    assert.equal(request.parameters.uri, URI);
    assert.equal(request.parameters.projectId, BETA);
    assert.equal(request.parameters.version, 1);
    assert.ok(request.signal instanceof AbortSignal);
  }
  const sent = workers.workers.flatMap(worker => worker.requests.map(request => ({worker, request})));
  assert.ok(sent.every(({worker, request}) => worker.options.name === `compiler:${BETA}` && request.params.projectId === BETA));
  assert.equal(services.builds.activeId, ALPHA);
});

test('preparation captures the version before waiting and never installs an outdated root', async t => {
  const {model, services, control} = fixture(t);
  const started = deferred();
  const release = deferred();
  control.beforeReply = async () => { started.resolve(); await release.promise; };
  const pending = model.prepare({uri: URI, offset: beta.indexOf('Root')});
  await started.promise;
  services.documents.get(URI).model.applyEdits([{start: 0, end: 0, text: '// newer\n'}]);
  release.resolve();
  await assert.rejects(pending, /stale|changed/i);
  assert.equal(model.roots.length, 0);
});

test('expansion and navigation reject a source edited after preparation', async t => {
  const {model, services} = fixture(t);
  const [root] = await model.prepare({uri: URI, offset: beta.indexOf('Root')});
  await model.expand(root.children[1]);
  const child = root.children[1].children[0];
  services.documents.get(URI).model.applyEdits([{start: 0, end: 0, text: '// newer\n'}]);
  await assert.rejects(model.expand(root.children[0]), /stale/);
  assert.throws(() => model.location(child), /stale/);
  assert.throws(() => model.location(child, child.ranges[0]), /stale/);
});

test('disposal cancels an outstanding compiler operation and prevents late tree publication', async t => {
  const {model, control, requests} = fixture(t);
  const started = deferred();
  const release = deferred();
  control.beforeReply = async () => { started.resolve(); await release.promise; };
  const pending = model.prepare({uri: URI, offset: beta.indexOf('Root')});
  await started.promise;
  model.dispose();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(requests[0].signal.aborted, true);
  release.resolve();
  assert.equal(model.roots.length, 0);
});

test('worker rejects a call item from a different project or document even at the same revision', async t => {
  const {model, projects} = fixture(t);
  const [root] = await model.prepare({uri: URI, offset: beta.indexOf('Root')});
  await assert.rejects(projects.request('incomingCalls', {uri: URI, version: 1, projectId: BETA,
    item: {...root.item, projectId: ALPHA}}), {code: 'SFED1202'});
  await assert.rejects(projects.request('outgoingCalls', {uri: URI, version: 1, projectId: BETA,
    item: {...root.item, uri: 'Alpha/Program.cs'}}), {code: 'SFED1202'});
});

test('project configuration changes invalidate prepared call items without requiring a source edit', async t => {
  const {model, state, projects, services} = fixture(t);
  const [root] = await model.prepare({uri: URI, offset: beta.indexOf('Root')});
  assert.equal(root.item.projectRevision, services.builds.get(BETA).revision);
  state.configuration = 'Release';
  projects.sync();
  assert.equal(services.documents.get(URI).version, 1);
  await assert.rejects(model.expand(root.children[0]), {code: 'SFED1202'});
});

test('public shell entry prepares the real model before opening and invalidating its shared tool', async t => {
  const {model} = fixture(t);
  const events = [];
  const shell = {calls: model, disposed: false,
    activateTool: async id => { events.push(['activate', id, model.roots.length]); },
    invalidateTool: id => events.push(['invalidate', id])};
  const roots = await WorkbenchShell.prototype.openCallHierarchy.call(shell, {uri: URI, offset: beta.indexOf('Root')});
  assert.equal(roots[0].projectId, BETA);
  assert.deepEqual(events, [['activate', 'calls', 1], ['invalidate', 'calls']]);
});
