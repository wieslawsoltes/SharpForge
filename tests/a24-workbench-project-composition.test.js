import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem } from '@sharpforge/project-system';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { BuildService } from '../apps/studio/workbench/build.js';
import { StudioProjects } from '../apps/studio/workbench/studio-projects.js';
import { StudioProjectCompiler } from '../apps/studio/workbench/studio-project-compiler.js';
import { StudioExecution } from '../apps/studio/workbench/studio-execution.js';
import { compileProjectPlan } from '../apps/studio/workers/compilation-handler.js';
import { deferred, fakeWorkers, compileResult, settle } from './a19-session-fixtures.js';

test('workbench compiler contribution preserves raw worker routing and stale-result ownership', async () => {
  const reply = deferred();
  const fake = fakeWorkers(() => reply.promise);
  const calls = [];
  const service = new BuildService({ id: 'App.csproj' }, {
    workerFactory: fake.factory,
    requestCompiler: async operation => {
      calls.push(operation.projectId);
      return operation.request(operation.method, { ...operation.params, files: [{ uri: 'Program.cs', text: 'class C {}' }] });
    }
  });
  try {
    const pending = service.request('analyze', { selected: true });
    await settle();
    service.invalidate('source');
    reply.resolve(compileResult());
    await assert.rejects(pending, { code: 'BUILD_STALE' });
    assert.deepEqual(calls, ['App.csproj']);
    assert.equal(fake.workers[0].requests[0].params.selected, true);
    assert.equal(fake.workers[0].requests[0].params.files[0].uri, 'Program.cs');
    assert.equal(service.result, null);
  } finally { service.dispose(); }
});

test('project preparation pins background selection and forwards worker cancellation', async () => {
  const state = { projectSystem: {}, disk: {}, workspaceEpoch: 1, revision: 1, startupProject: 'Active.csproj', files: [] };
  const seen = [];
  const compiler = new StudioProjectCompiler(() => state, { compile: async (view, worker, method, params) => {
    seen.push(view.startupProject);
    return worker.request(method, { project: view.startupProject, signalReceived: !!params.signal });
  } });
  const abort = new AbortController();
  const result = await compiler.request({ projectId: 'Background.csproj', method: 'analyze', options: { signal: abort.signal },
    request: async (method, params, options) => ({ method, params, signal: options.signal }) });
  assert.deepEqual(seen, ['Background.csproj']);
  assert.equal(state.startupProject, 'Active.csproj');
  assert.equal(result.signal, abort.signal);
  assert.equal(result.params.signalReceived, true);
});

test('queued graph preparation rejects cancellation and retired workspace revisions before compiler work', async () => {
  const state = { projectSystem: {}, disk: {}, workspaceEpoch: 1, revision: 1, files: [] };
  const first = deferred();
  const calls = [];
  const compiler = new StudioProjectCompiler(() => state, { compile: async view => {
    calls.push(view.startupProject);
    if (calls.length === 1) return first.promise;
    return compileResult();
  } });
  const abort = new AbortController();
  const initial = compiler.request({ projectId: 'First.csproj', method: 'build', request() {} });
  await settle();
  const cancelled = compiler.request({ projectId: 'Cancelled.csproj', method: 'build', options: { signal: abort.signal }, request() {} });
  const stale = compiler.request({ projectId: 'Stale.csproj', method: 'build', request() {} });
  abort.abort('cancel queued project');
  state.revision++;
  const cancelledAssertion = assert.rejects(cancelled, { name: 'AbortError' });
  const staleAssertion = assert.rejects(stale, { code: 'BUILD_STALE' });
  first.resolve(compileResult());
  await initial;
  await Promise.all([cancelledAssertion, staleAssertion]);
  assert.deepEqual(calls, ['First.csproj']);
});

function projectsFixture() {
  const records = [
    { path: 'All.slnx', text: '<Solution><Project Path="App/App.csproj"/><Project Path="Lib/Lib.csproj"/></Solution>' },
    { path: 'App/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType>'
      + '<TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>'
      + '<ProjectReference Include="../Lib/Lib.csproj"/></ItemGroup></Project>' },
    { path: 'Lib/Lib.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>'
      + '<TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>' },
    { path: 'App/Program.cs', text: 'class Program { static void Main() { System.Console.WriteLine(Library.Value()); } }' },
    { path: 'Lib/Library.cs', text: 'public class Library { public static int Value() { return 42; } }' }
  ];
  const system = new ProjectSystem(records);
  system.load('All.slnx');
  const requests = [];
  const workers = fakeWorkers(message => {
    requests.push(message);
    return message.params.buildPlan ? compileProjectPlan(message.params.buildPlan) : compileResult();
  });
  let projects;
  const services = createWorkbenchServices({ workerFactory: workers.factory,
    records: records.filter(record => record.path.endsWith('.cs')).map(record => ({ uri: record.path, text: record.text })),
    getProjectSnapshot: id => projects.snapshot(id), requestCompiler: request => projects.compile(request) });
  const state = { projectSystem: system, projectSnapshot: system.snapshot(), disk: null, revision: 1, workspaceEpoch: 1,
    startupProject: 'App/App.csproj', active: 'App/Program.cs', files: services.documents.files, name: 'All',
    configuration: 'Debug', langVersion: '14', breakpoints: {}, functionBreakpoints: [], nativeMode: false,
    debugSettings: {}, extraFiles: [] };
  projects = new StudioProjects(services, { state: () => state });
  projects.sync();
  return { services, projects, state, requests, close() { projects.dispose(); services.dispose(); } };
}

test('incoming build queue reaches the structured two-project compiler and retains emitted dependency envelopes', async () => {
  const fixture = projectsFixture();
  try {
    const result = await fixture.services.queue.run(['App/App.csproj']);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.succeeded, ['Lib/Lib.csproj', 'App/App.csproj']);
    const built = result.results.get('App/App.csproj');
    assert.equal(built.success, true);
    assert.equal(built.projectArtifacts.length, 2);
    const library = built.projectArtifacts.find(artifact => artifact.project === 'Lib/Lib.csproj');
    assert.ok(library.assembly instanceof Uint8Array);
    const launch = fixture.projects.launchOptions('App/App.csproj', { id: 'default', arguments: [], environment: {} }, built);
    assert.equal(launch.dependencies.length, 1);
    assert.equal(launch.dependencies[0].assembly, library.assembly);
    assert.equal(launch.dependencies[0].contextId, library.contextId);
    assert.equal(fixture.state.startupProject, 'App/App.csproj');
    assert.ok(fixture.requests.every(request => request.params.buildPlan.units.length === 1));
    assert.ok(fixture.requests.some(request => request.params.buildPlan.dependencyArtifacts.length === 1));
  } finally { fixture.close(); }
});

test('library invalidation retires its consumers without selecting a background project', () => {
  const fixture = projectsFixture();
  try {
    const app = fixture.services.builds.get('App/App.csproj');
    app.dirty = false;
    const before = app.revision;
    fixture.services.builds.get('Lib/Lib.csproj').invalidate('source');
    assert.equal(app.dirty, true);
    assert.equal(app.revision, before + 1);
    assert.equal(fixture.services.builds.activeId, 'App/App.csproj');
  } finally { fixture.close(); }
});

test('explicit workbench launch profiles keep argument and environment precedence over project defaults', () => {
  const state = { projectSystem: { runOptions: () => ({ commandName: 'Project', args: ['project'],
    environment: { SHARED: 'project', ONLY_PROJECT: 'yes' }, workingDirectory: 'src' }) },
  files: [], debugSettings: {}, functionBreakpoints: [] };
  const compiler = new StudioProjectCompiler(() => state);
  const profile = { arguments: ['workbench'], environment: { SHARED: 'profile' } };
  const result = compiler.launchOptions('App.csproj', profile, compileResult(), true);
  assert.deepEqual(result.programArguments, ['workbench']);
  assert.deepEqual(result.environment, { SHARED: 'profile', ONLY_PROJECT: 'yes' });
  assert.equal(result.workingDirectory, 'src');
  assert.throws(() => compiler.launchOptions('App.csproj', profile, compileResult(false), true), /successful build/);
});

test('native run and recovery guards retain the incoming execution coordinator', async () => {
  const state = { nativeMode: true, recoveryReadOnly: false };
  const calls = [];
  const services = createWorkbenchServices();
  const execution = new StudioExecution({ services, projects: {}, state: () => state,
    ui: { nativeBuild: () => ({ runProject: async () => { calls.push('run'); return 42; } }) } });
  try {
    assert.equal(await execution.launch(false), 42);
    await assert.rejects(execution.launch(true), /Native process attachment is unavailable/);
    state.recoveryReadOnly = true;
    await assert.rejects(execution.launch(false), /Grant folder access/);
    await assert.rejects(execution.build(), /Grant folder access/);
    assert.deepEqual(calls, ['run']);
  } finally { execution.dispose(); services.dispose(); }
});
