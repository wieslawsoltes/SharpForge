import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSystem } from '@sharpforge/project-system';
import { EditorModel } from '@sharpforge/editor';
import { Workspace } from '@sharpforge/workspace';
import { LanguageService } from '@sharpforge/language';
import { RefactoringEngine } from '@sharpforge/refactoring';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { StudioProjects } from '../apps/studio/workbench/studio-projects.js';
import { createStudioEditorFactory } from '../apps/studio/workbench/studio-editor.js';
import { createStudioLanguageProviders, studioProjectDocuments, studioDocumentProjects }
  from '../apps/studio/workbench/studio-language-providers.js';
import { TestProviders } from '../apps/studio/workbench/tools/test-explorer.js';
import { createTestCodeLensProvider } from '../apps/studio/workbench/test-code-lens.js';
import { TaskCenter } from '../apps/studio/workbench/task-center.js';
import { createWorkerProtocol } from '../apps/studio/workers/protocol.js';
import { registerEditorLanguageHandlers } from '../apps/studio/workers/editor-language.js';
import { deferred, fakeWorkers } from './a19-session-fixtures.js';

const ALPHA = 'Alpha/Alpha.csproj';
const BETA = 'Beta/Beta.csproj';
const explicitType = 'sharpforge.local.explicit-type';
const source = name => `class ${name} { int M(){var number=1;return number;} }`;

function records() {
  const project = references => '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Library</OutputType>'
    + '</PropertyGroup><ItemGroup><Compile Include="../Shared.cs"/>' + references + '</ItemGroup></Project>';
  return [
    { path: 'Apps.slnx', text: '<Solution><Project Path="Alpha/Alpha.csproj"/><Project Path="Beta/Beta.csproj"/></Solution>' },
    { path: ALPHA, text: project('<ProjectReference Include="../Beta/Beta.csproj"/>') },
    { path: BETA, text: project('') },
    { path: 'Alpha/Program.cs', text: source('Alpha') },
    { path: 'Beta/Program.cs', text: source('Beta') },
    { path: 'Shared.cs', text: source('Shared') }
  ];
}

/** Exercise real compiler handlers through the existing deterministic worker fixture, without a browser-worker claim. */
function compilerReply(control, contexts) {
  return async (message, worker) => {
    let context = contexts.get(worker);
    if (!context) {
      const workspace = new Workspace();
      const language = new LanguageService(workspace);
      const protocol = createWorkerProtocol('compiler');
      registerEditorLanguageHandlers(protocol, { workspace, language, refactoring: new RefactoringEngine(workspace, language) });
      context = { workspace, protocol };
      contexts.set(worker, context);
    }
    const { workspace, protocol } = context;
    const { params, method } = message;
    const available = new Set(params.files.map(file => file.uri));
    for (const uri of workspace.documents.keys()) if (!available.has(uri)) workspace.remove(uri);
    for (const file of params.files) workspace.update(file.uri, file.text, file.version);
    workspace.compilationOptions = params.compilationOptions;
    workspace.result = null;
    const result = protocol.dispatch(method, params);
    await control.beforeReply?.(method, params);
    return result;
  };
}

async function fixture(t) {
  const files = records();
  const projectSystem = new ProjectSystem(files);
  projectSystem.load('Apps.slnx');
  const control = {};
  const contexts = new Map();
  const workers = fakeWorkers(compilerReply(control, contexts));
  let projects;
  const services = createWorkbenchServices({
    workerFactory: workers.factory,
    records: files.filter(file => file.path.endsWith('.cs')).map(file => ({ uri: file.path, text: file.text, version: 1 })),
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version }),
    getProjectSnapshot: id => projects.snapshot(id)
  });
  const state = { projectSystem, files: services.documents.files, startupProject: ALPHA, active: 'Alpha/Program.cs',
    name: 'Apps', langVersion: '14', configuration: 'Debug', workspaceEpoch: 1, nativeMode: false, breakpoints: {} };
  projects = new StudioProjects(services, { state: () => state });
  projects.sync();
  const tests = new TestProviders();
  const tasks = new TaskCenter();
  const runs = [];
  const unregister = tests.register('suite', {
    discover: async () => [
      { id: 'library', name: 'Library test', uri: 'Beta/Program.cs', version: 1, projectId: BETA, start: 17, end: 18 },
      { id: 'linked-a', name: 'Linked Alpha', uri: 'Shared.cs', version: 1, projectId: ALPHA, start: 19, end: 20 },
      { id: 'linked-b', name: 'Linked Beta', uri: 'Shared.cs', version: 1, projectId: BETA, start: 19, end: 20 },
      { id: 'ambiguous', name: 'Ambiguous linked test', uri: 'Shared.cs', version: 1, start: 19, end: 20 }
    ],
    run: async (ids, { onResult }) => {
      runs.push(ids);
      for (const id of ids) onResult({ id, state: 'passed', duration: 2 });
    }
  });
  await tests.discover();
  const lenses = createTestCodeLensProvider({
    tests, getDocument: uri => services.documents.get(uri),
    projectIdsForUri: uri => studioDocumentProjects(state, services.documents, uri),
    execute: operation => tasks.run({ label: 'Run selected test', projectId: operation.projectId },
      task => operation.run({ signal: task.signal }))
  });
  const hostCalls = [];
  const requestHost = (...args) => { hostCalls.push(args); return true; };
  const providers = createStudioLanguageProviders({ projects, documents: services.documents, state: () => state,
    getTestCodeLens: () => lenses, requestHost });
  const integration = createStudioEditorFactory({ services, state: () => state, providers, requestHost,
    requestCompiler: (method, params, options) => projects.request(method, params, options) });
  const unsubscribe = lenses.subscribe(event => integration.language.invalidate('codeLens', { uri: event.uri }));
  t.after(() => {
    unsubscribe();
    integration.dispose();
    lenses.dispose();
    tests.dispose();
    tasks.dispose();
    services.dispose();
    for (const context of contexts.values()) context.protocol.dispose();
  });
  return { state, services, projects, control, integration, tests, lenses, tasks, runs, unregister, hostCalls };
}

test('Studio direct ownership excludes dependency-only membership and retains genuine linked-file owners', async t => {
  const current = await fixture(t);
  const { state, services, projects } = current;
  assert.ok(projects.sourceUris(ALPHA).includes('Beta/Program.cs'));
  assert.deepEqual(services.documents.projectsFor('Beta/Program.cs'), [ALPHA, BETA]);
  assert.deepEqual(studioProjectDocuments(state, services.documents, ALPHA).sort(), ['Alpha/Program.cs', 'Shared.cs']);
  assert.deepEqual(studioDocumentProjects(state, services.documents, 'Beta/Program.cs'), [BETA]);
  assert.deepEqual(studioDocumentProjects(state, services.documents, 'Shared.cs'), [ALPHA, BETA]);
  assert.deepEqual(studioProjectDocuments(state, services.documents, 'Missing.csproj'), []);
  state.projectSystem = null;
  assert.deepEqual(studioDocumentProjects(state, services.documents, 'Shared.cs'), ['$workspace']);
  assert.deepEqual(studioDocumentProjects(state, services.documents, 'Missing.cs'), []);
  assert.deepEqual(studioProjectDocuments(state, services.documents, '$workspace').sort(),
    ['Alpha/Program.cs', 'Beta/Program.cs', 'Shared.cs']);
});

test('composed project Fix All changes owned sources through real compiler validation without editing a dependency', async t => {
  const current = await fixture(t);
  const request = { uri: 'Alpha/Program.cs', version: 1, offset: source('Alpha').indexOf('number'),
    projectId: ALPHA, scope: 'project', equivalenceKey: explicitType };
  const actions = await current.integration.language.invoke('codeActions', request);
  assert.deepEqual(actions[0].edits.map(edit => edit.uri), ['Alpha/Program.cs', 'Shared.cs']);
  assert.ok(current.services.documents.list().every(record => record.text.includes('var number=')));
  current.integration.apply(actions[0].edits, 'Fix all explicit types in Alpha');
  assert.ok(current.services.documents.require('Alpha/Program.cs').text.includes('int number='));
  assert.ok(current.services.documents.require('Shared.cs').text.includes('int number='));
  assert.ok(current.services.documents.require('Beta/Program.cs').text.includes('var number='));
  assert.equal(current.services.builds.activeId, ALPHA);
});

test('composed solution Fix All deduplicates linked sources and preserves preview-only ownership', async t => {
  const current = await fixture(t);
  const actions = await current.integration.language.invoke('codeActions', {
    uri: 'Alpha/Program.cs', version: 1, projectId: ALPHA, scope: 'solution', equivalenceKey: explicitType
  });
  assert.deepEqual(actions[0].edits.map(edit => edit.uri), ['Alpha/Program.cs', 'Beta/Program.cs', 'Shared.cs']);
  assert.ok(actions[0].edits.every(edit => edit.newText === 'int' && edit.version === 1));
  assert.ok(current.services.documents.list().every(record => record.text.includes('var number=')));
});

test('reference and test lenses compose while test resolve/run use the actual owning provider and TaskCenter', async t => {
  const current = await fixture(t);
  const request = { uri: 'Beta/Program.cs', version: 1 };
  const response = await current.integration.language.invoke('codeLens', request);
  assert.equal(response.uri, request.uri);
  assert.equal(response.version, 1);
  const references = response.items.filter(item => item.count !== undefined);
  assert.ok(references.length > 0);
  const tests = response.items.filter(item => item.data?.provider === 'tests');
  assert.deepEqual(tests.map(item => item.data.testId), ['suite:library']);
  assert.equal(tests[0].data.projectId, BETA);
  assert.deepEqual(await current.integration.language.invoke('resolveCodeLens', { ...request, lens: references[0] }), references[0]);
  const resolved = await current.integration.language.invoke('resolveCodeLens', { ...request, lens: tests[0] });
  const changed = [];
  current.integration.language.subscribe(event => changed.push(event));
  await current.integration.language.invoke('executeCommand', { ...request, ...resolved.command });
  assert.deepEqual(current.runs, [['library']]);
  assert.equal(current.tests.tests.get('suite:library').state, 'passed');
  assert.equal(current.tasks.list()[0].status, 'completed');
  assert.equal(current.tasks.list()[0].projectId, BETA);
  assert.ok(changed.some(event => event.method === 'codeLens' && event.uri === request.uri));
  assert.deepEqual(current.hostCalls, []);
});

test('explicit linked-file context runs only its selected test owner, while ambiguous inferred ownership remains hidden', async t => {
  const current = await fixture(t);
  const request = { uri: 'Shared.cs', version: 1, projectId: BETA };
  const response = await current.integration.language.invoke('codeLens', request);
  const tests = response.items.filter(item => item.data?.provider === 'tests');
  assert.deepEqual(tests.map(item => item.data.testId), ['suite:linked-b']);
  const resolved = await current.integration.language.invoke('resolveCodeLens', { ...request, lens: tests[0] });
  await current.integration.language.invoke('executeCommand', { ...request, ...resolved.command });
  assert.deepEqual(current.runs, [['linked-b']]);
  assert.equal(current.tests.tests.get('suite:linked-a').state, 'not-run');
  assert.equal(current.tests.tests.get('suite:ambiguous').state, 'not-run');
});

test('non-test lens commands forward the real host command and its argument without running a test', async t => {
  const current = await fixture(t);
  await current.integration.language.invoke('executeCommand', {
    uri: 'Beta/Program.cs', version: 1, command: 'openDocument', arguments: [{ uri: 'Shared.cs', start: 19 }]
  });
  await current.integration.language.invoke('executeCommand', { uri: 'Beta/Program.cs', version: 1, command: 'save' });
  assert.deepEqual(current.hostCalls, [
    ['openDocument', { uri: 'Shared.cs', start: 19 }], ['save', { uri: 'Beta/Program.cs', version: 1 }]
  ]);
  assert.deepEqual(current.runs, []);
});

test('cancelling pending semantic lenses prevents the test provider from publishing combined results', async t => {
  const current = await fixture(t);
  const started = deferred();
  const pending = deferred();
  current.control.beforeReply = async method => { if (method === 'referenceLenses') { started.resolve(); await pending.promise; } };
  const controller = new AbortController();
  const result = current.integration.language.invoke('codeLens', { uri: 'Beta/Program.cs', version: 1, signal: controller.signal });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  current.lenses.dispose();
  pending.resolve();
  await rejected;
  assert.deepEqual(current.runs, []);
});

test('removed test providers and changed direct ownership cannot execute retained CodeLens commands', async t => {
  const current = await fixture(t);
  const request = { uri: 'Beta/Program.cs', version: 1 };
  const response = await current.integration.language.invoke('codeLens', request);
  const lens = response.items.find(item => item.data?.provider === 'tests');
  const resolved = await current.integration.language.invoke('resolveCodeLens', { ...request, lens });
  const project = current.state.projectSystem.projects.get(BETA);
  const compile = project.compile;
  project.compile = compile.filter(item => item.path !== request.uri);
  await assert.rejects(current.integration.language.invoke('executeCommand', { ...request, ...resolved.command }), { code: 'SFTEST1003' });
  project.compile = compile;
  current.unregister();
  await assert.rejects(current.integration.language.invoke('executeCommand', { ...request, ...resolved.command }), { code: 'SFTEST1005' });
  assert.deepEqual(current.runs, []);
  assert.deepEqual(current.hostCalls, []);
});
