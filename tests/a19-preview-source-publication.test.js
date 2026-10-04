import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor, EditorModel, EditorModelWorkspace, prepareWorkspaceEdit, commitWorkspaceEdit} from '@sharpforge/editor';
import {Workspace} from '@sharpforge/workspace';
import {createWorkbenchServices} from '../apps/studio/workbench/sessions.js';
import {StudioProjects} from '../apps/studio/workbench/studio-projects.js';
import {StudioExecution} from '../apps/studio/workbench/studio-execution.js';
import {createStudioRecords} from '../apps/studio/workbench/workspace-records.js';
import {documentSize, readDocumentRange} from '../apps/studio/workbench/document-size.js';
import {captureExplorerRecord} from '../apps/studio/explorer-records.js';
import {editorConfigFilesForDocument} from '../apps/studio/workbench/editor-configuration.js';
import {applyExplorerResourceTransaction} from '../apps/studio/explorer-resource-transaction.js';
import {explorerDocuments} from './fixtures/a19-explorer-document-fixture.js';
import {RenamePreview} from '../packages/editor/src/features/rename-preview.js';
import {compileResult, deferred, fakeWorkers} from './a19-session-fixtures.js';

function previewFor(model) {
  return new RenamePreview({model, get value() { return model.value; }, refreshPreview() {}});
}

function fixture(t, {saveDocument} = {}) {
  const compilerWorkspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  const requests = [];
  const workers = fakeWorkers(message => {
    requests.push(message);
    for (const file of message.params.files ?? []) compilerWorkspace.update(file.uri, file.text, file.version);
    return compileResult();
  });
  let projects;
  const services = createWorkbenchServices({
    records: [{uri: 'A.cs', text: 'class Name {}', version: 1}, {uri: 'B.cs', text: 'class Other {}', version: 1}],
    createModel: record => new EditorModel(record.text, {uri: record.uri, version: record.version}),
    workerFactory: workers.factory, saveDocument, getProjectSnapshot: id => projects.snapshot(id)
  });
  const state = services.createStateFacade({name: 'Preview', langVersion: 'default', extraFiles: [], workspaceEpoch: 1});
  services.documents.open('A.cs');
  projects = new StudioProjects(services, {state: () => state});
  projects.sync();
  const errors = [];
  const execution = new StudioExecution({services, projects, state: () => state,
    ui: {applyAnalysis() {}, error: error => errors.push(error)}});
  t.after(() => { execution.dispose(); projects.dispose(); services.dispose(); });
  return {services, documents: services.documents, projects, state, execution, errors, compilerWorkspace, requests};
}

test('pending Studio analysis and another editor whole-project request publish committed rename source only', async t => {
  const {documents, projects, execution, compilerWorkspace, requests, errors} = fixture(t);
  const model = documents.models.get('A.cs');
  let pendingAnalysis;
  documents.subscribe(event => { if (event.type === 'changed') pendingAnalysis = () => execution.analyze(); });
  model.applyEdits([{start: model.length, end: model.length, text: '\n'}]);
  const source = model.snapshot();
  const preview = previewFor(model);
  preview.show([{start: 6, end: 10, text: 'TemporaryLongName'}]);
  assert.notEqual(model.snapshot(), source);
  assert.equal((await pendingAnalysis()).success, true);
  // Studio's documentSymbols provider maps to the compiler protocol's symbols request.
  await projects.request('symbols', {uri: 'B.cs'});
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => request.method), ['analyze', 'symbols']);
  for (const request of requests) {
    const file = request.params.files.find(item => item.uri === 'A.cs');
    assert.equal(file.text, source.text);
    assert.equal(file.version, source.version);
  }
  assert.equal(compilerWorkspace.documents.get('A.cs').source.version, source.version);
  preview.release();
  await execution.analyze();
  assert.deepEqual(errors, []);
  assert.equal(compilerWorkspace.documents.get('A.cs').source.text, source.text);
  assert.equal(model.undoStack.depth, 1);
});

test('real rename completion publishes its new version after lease release and remains one undo operation', async t => {
  const {documents, projects, compilerWorkspace} = fixture(t);
  const model = documents.models.get('A.cs');
  const workspace = new EditorModelWorkspace(documents.models);
  const preview = previewFor(model);
  const plan = prepareWorkspaceEdit(workspace, [{uri: 'A.cs', version: 1, start: 6, end: 10, newText: 'Renamed'}]);
  preview.show(plan.changes[0].edits);
  await projects.request('symbols', {uri: 'B.cs'});
  assert.equal(compilerWorkspace.documents.get('A.cs').source.text, 'class Name {}');
  preview.release();
  await commitWorkspaceEdit(workspace, plan);
  await projects.request('symbols', {uri: 'B.cs'});
  assert.equal(compilerWorkspace.documents.get('A.cs').source.text, 'class Renamed {}');
  assert.equal(compilerWorkspace.documents.get('A.cs').source.version, 2);
  assert.equal(documents.get('A.cs').dirty, true);
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(documents.get('A.cs').text, 'class Name {}');
});

test('DocumentService late save acknowledgement survives preview cancellation and subsequent undo', async t => {
  const io = deferred();
  let written;
  const {documents} = fixture(t, {saveDocument: snapshot => { written = snapshot; return io.promise; }});
  const model = documents.models.get('A.cs');
  model.applyEdits([{start: model.length, end: model.length, text: '\n'}]);
  const source = model.snapshot();
  const events = [];
  documents.subscribe(event => events.push({type: event.type, dirty: event.dirty}));
  const saving = documents.save('A.cs');
  assert.equal(written.source, source);
  const preview = previewFor(model);
  preview.show([{start: 6, end: 10, text: 'Temporary'}]);
  io.resolve(true);
  assert.equal(await saving, true);
  assert.equal(documents.baselines.get('A.cs'), source);
  assert.equal(documents.staleSaves.has('A.cs'), false);
  assert.equal(documents.get('A.cs').dirty, false);
  preview.release();
  assert.equal(model.snapshot(), source);
  assert.equal(model.isDirty, false);
  assert.equal(model.undo(), true);
  assert.equal(documents.get('A.cs').dirty, true);
  assert.equal(documents.baselines.get('A.cs'), source);
  assert.ok(events.some(event => event.type === 'saved' && event.dirty === false));
  assert.ok(events.some(event => event.type === 'dirty' && event.dirty === true));
});

test('save, operation state, export, diagnostics and bounded ranges share one published source revision', t => {
  const {documents, projects, state} = fixture(t);
  const model = documents.models.get('A.cs'), source = model.snapshot();
  const preview = previewFor(model);
  preview.show([{start: 6, end: 10, text: 'TemporaryLongName'}]);
  const record = documents.get('A.cs');
  const saved = documents.captureSave('A.cs');
  const captured = documents.captureState('A.cs');
  const exported = createStudioRecords({state, documents}).find(item => item.path === 'A.cs');
  const diagnostic = projects.diagnostics.capture('A.cs');
  const explorerCapture = captureExplorerRecord(exported);
  for (const item of [record, saved, captured, exported, diagnostic, explorerCapture]) {
    assert.equal(item.source, source);
    assert.equal(item.version, source.version);
  }
  assert.equal(documentSize(documents, record), source.length);
  assert.deepEqual(readDocumentRange(documents, record, {start: 6, end: 10}),
    {text: 'Name', start: 6, end: 10, length: source.length, truncated: true});
  assert.equal(saved.text, 'class Name {}');
  assert.equal(exported.text, 'class Name {}');
  preview.release();
});

test('reload and prepared model adoption reject active previews without changing source, baseline or metadata', t => {
  const {documents} = fixture(t);
  const model = documents.models.get('A.cs'), source = model.snapshot(), record = documents.get('A.cs');
  const preview = previewFor(model);
  preview.show([{start: 6, end: 10, text: 'Temporary'}]);
  const visual = model.snapshot();
  let metadataCommits = 0;
  assert.throws(() => documents.reload('A.cs', 'class Disk {}', {
    expectedRecord: record, expectedVersion: source.version, commitMetadata: () => metadataCommits++
  }), {code: 'DOCUMENT_PREVIEW_ACTIVE'});
  assert.throws(() => documents.replace([{uri: 'A.cs', model, source, version: source.version}], {discard: true}),
    {code: 'DOCUMENT_PREVIEW_ACTIVE'});
  assert.equal(documents.get('A.cs'), record);
  assert.equal(documents.baselines.get('A.cs'), source);
  assert.equal(model.snapshot(), visual);
  assert.equal(model.previewActive, true);
  assert.equal(metadataCommits, 0);
  preview.release();
});

test('an atomic change still notifies the second document if the first notification opens its preview', async t => {
  const {documents} = fixture(t);
  const workspace = new EditorModelWorkspace(documents.models);
  const model = documents.models.get('B.cs');
  const changes = [];
  let preview;
  documents.subscribe(event => {
    if (event.type !== 'changed') return;
    changes.push({uri: event.uri, files: documents.list().map(record => record.text)});
    if (event.uri === 'A.cs') {
      preview = previewFor(model);
      preview.show([{start: 6, end: 11, text: 'Temporary'}]);
    }
  });
  const plan = prepareWorkspaceEdit(workspace, [
    {uri: 'A.cs', version: 1, start: 6, end: 10, newText: 'First'},
    {uri: 'B.cs', version: 1, start: 6, end: 11, newText: 'Second'}
  ]);
  await commitWorkspaceEdit(workspace, plan);
  assert.deepEqual(changes, [
    {uri: 'A.cs', files: ['class First {}', 'class Second {}']},
    {uri: 'B.cs', files: ['class First {}', 'class Second {}']}
  ]);
  assert.equal(documents.get('B.cs').dirty, true);
  assert.equal(model.isDirty, true);
  preview.release();
  assert.equal(model.value, 'class Second {}');
  assert.equal(model.undo(), true);
  assert.equal(model.value, 'class Other {}');
});

test('workspace replacement disposes the original preview model and delayed cleanup cannot restore over its replacement', t => {
  const {documents} = fixture(t);
  const original = documents.models.get('A.cs');
  const preview = previewFor(original);
  preview.show([{start: 6, end: 10, text: 'Temporary'}]);
  documents.replace([{uri: 'A.cs', text: 'class Replacement {}', version: 20}], {discard: true});
  assert.equal(original.previewActive, false);
  preview.dispose();
  assert.equal(documents.get('A.cs').text, 'class Replacement {}');
  assert.equal(documents.get('A.cs').version, 20);
  assert.equal(documents.get('A.cs').dirty, false);
});

test('EditorConfig reads committed source even if its model is displaying a temporary preview', () => {
  const model = new EditorModel('[*.cs]\nindent_size=4', {uri: '.editorconfig'});
  const source = model.snapshot();
  const preview = previewFor(model);
  preview.show([{start: model.length - 1, end: model.length, text: '8'}]);
  const files = editorConfigFilesForDocument('A.cs', [{uri: model.uri, model}], {models: new Map([[model.uri, model]])});
  assert.equal(files[0].text, source.text);
  preview.release();
  model.dispose();
});

test('workspace commit forwards cancellation into the real asynchronous Studio resource transaction', async () => {
  const host = explorerDocuments([{path: 'Alpha.cs', text: 'class Alpha {}\n' + '// padding\n'.repeat(100000)}]);
  const model = host.documents.models.get('Alpha.cs');
  const before = model.snapshot();
  const workspace = new EditorModelWorkspace(host.documents.models, {
    applyResourceTransaction: (plan, {signal}) => applyExplorerResourceTransaction(plan, {
      documents: host.documents, explorer: host.commands, signal
    })
  });
  const plan = prepareWorkspaceEdit(workspace, {
    edits: [{uri: model.uri, version: model.version, start: 6, end: 11, newText: 'Beta'}],
    resources: [{kind: 'rename', oldUri: model.uri, newUri: 'Beta.cs', version: model.version}]
  });
  const controller = new AbortController();
  const pending = commitWorkspaceEdit(workspace, plan, {signal: controller.signal});
  controller.abort();
  await assert.rejects(pending, {code: 'SFEX_RESOURCE_CANCELLED'});
  assert.equal(host.documents.models.get('Alpha.cs'), model);
  assert.equal(model.snapshot(), before);
  assert.equal(host.documents.get('Beta.cs'), null);
  assert.equal(host.commands.history.length, 0);
  host.dispose();
});

test('closing all views releases the owned preview before any same-model view state is cached', t => {
  const {documents} = fixture(t);
  const model = documents.models.get('A.cs');
  model.setSelections([{anchor: 6, active: 10}]);
  const original = model.primarySelection;
  let preview;
  const order = [];
  const view = id => ({model, element: {},
    prepareViewState: CodeEditor.prototype.prepareViewState,
    getViewState() {
      assert.equal(model.previewActive, false);
      order.push('capture:' + id);
      return {start: model.primarySelection.start, end: model.primarySelection.end};
    },
    dispose() { order.push('dispose:' + id); }
  });
  const secondary = view('secondary');
  const owner = view('owner');
  documents.attachEditor('A.cs', secondary, {viewId: 'secondary'});
  documents.attachEditor('A.cs', owner, {viewId: 'owner'});
  owner.insights = {cancelRename() { order.push('release'); preview.release(); }};
  preview = previewFor(model);
  preview.show([{start: 6, end: 10, text: 'TemporaryLongName'}]);
  documents.close('A.cs');
  assert.deepEqual(order, ['release', 'capture:secondary', 'dispose:secondary', 'capture:owner', 'dispose:owner']);
  documents.open('A.cs');
  assert.equal(documents.models.get('A.cs'), model);
  assert.equal(model.previewActive, false);
  assert.deepEqual(documents.getViewState('A.cs', 'owner'), {start: original.start, end: original.end});
});
