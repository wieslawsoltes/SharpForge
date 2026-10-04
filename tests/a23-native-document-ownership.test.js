import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, readEditorSource} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {createWorkspaceState} from '../apps/studio/workbench/state.js';
import {applyNativeProjectContext, collectNativeSourceChanges, createNativeContextHooks,
  nativeCompilationRequest} from '../apps/studio/native-build/workspace-state.js';
import {refreshNativeExplorerWorkspace} from '../apps/studio/native-build/explorer-refresh.js';
import {SlicedFile} from './fixtures/a20-source-file-fixture.js';

async function prepared(path, text, metadata = {}) {
  const record = await readEditorSource(new SlicedFile([new TextEncoder().encode(text)], path), {uri: path});
  Object.assign(record, metadata, {nativeHash: 'hash:' + path, nativeBaseline: record.source});
  Object.defineProperty(record, 'text', {configurable: true, enumerable: true,
    get() { throw new Error('Native document adoption must not flatten a prepared source'); }});
  return record;
}

function fixture(t, records) {
  const documents = new DocumentService({records,
    createModel: record => new EditorModel(record.text, {uri: record.uri, version: record.version})});
  const workspace = createWorkspaceState({nativeMode: true, workspaceEpoch: 1,
    nativeWorkspace: {root: '/native', files: records.map(record => ({path: record.uri}))},
    image: {}, assembly: new Uint8Array([1]), pdb: {}, ilDump: 'old', importedAssembly: true,
    breakpoints: {}}, {documents});
  t.after(() => { workspace.dispose(); documents.dispose(); });
  return {state: workspace.state, documents};
}

function payload(files) {
  return {context: {id: 'native:net10', project: 'App.csproj', targetFramework: 'net10.0', properties: {}},
    compilation: {files, options: {defineConstants: ['NATIVE_CONTEXT']}}};
}

test('native context adoption preserves dirty and unchanged models through one Documents replacement', async t => {
  const dirty = await prepared('A.cs', 'class Original {}');
  const stable = await prepared('Open.cs', 'class Open {}');
  const clean = await prepared('Clean.cs', 'class Clean {}');
  const obsolete = await prepared('old.g.cs', 'class OldGenerated {}', {generated: true, readOnly: true});
  const {state, documents} = fixture(t, [dirty, stable, clean, obsolete]);
  documents.open('A.cs');
  documents.open('old.g.cs');
  dirty.model.applyEdits([{start: 0, end: 0, text: '// local\n'}]);
  const captured = dirty.model.snapshot();
  const baseline = documents.baselines.get('A.cs');
  const revision = documents.revision;
  let resets = 0;
  documents.subscribe(event => { if (event.type === 'reset') resets++; });
  let editorResets = 0;
  const hooks = createNativeContextHooks({state, documents, resetEditors: () => editorResets++});
  const result = await hooks.onProjectContext(payload([
    {uri: 'A.cs', text: 'class ChangedOnDisk {}', hash: 'new-a'},
    {uri: 'Clean.cs', text: 'class NewClean {}', hash: 'new-clean'},
    {uri: 'new.g.cs', text: 'class NewGenerated {}', generated: true, readOnly: true}
  ]));
  assert.equal(resets, 1);
  assert.equal(editorResets, 0);
  assert.equal(documents.revision, revision + 1);
  assert.equal(state.files, documents.files);
  assert.equal(documents.models.get('A.cs'), dirty.model);
  assert.equal(documents.get('A.cs').source, captured);
  assert.equal(documents.baselines.get('A.cs'), baseline);
  assert.equal(documents.get('A.cs').nativeHash, 'hash:A.cs');
  assert.equal(documents.get('A.cs').dirty, true);
  assert.equal(documents.models.get('Open.cs'), stable.model);
  assert.equal(documents.get('Clean.cs').nativeHash, 'new-clean');
  assert.equal(documents.get('Clean.cs').dirty, false);
  assert.notEqual(documents.models.get('Clean.cs'), clean.model);
  assert.throws(() => clean.model.prepareEdits([]), /disposed/);
  assert.throws(() => obsolete.model.prepareEdits([]), /disposed/);
  assert.equal(documents.get('old.g.cs'), null);
  assert.equal(documents.get('new.g.cs').readOnly, true);
  assert.equal(state.active, 'A.cs');
  assert.deepEqual(result.files.map(record => record.uri), ['A.cs', 'Clean.cs', 'new.g.cs']);
  assert(result.files.every(record => record.model === undefined));
  assert.equal(result.files[0].source, captured);
  assert.equal(nativeCompilationRequest(state).contextId, 'native:net10');
  assert.equal(state.image, null);
  assert.equal(state.buildDirty, true);
  assert.equal(captured.statistics.textMaterialized, false);
  assert.equal(stable.source.statistics.textMaterialized, false);
});

test('native dirty-source saves capture immutable revisions without reading unrelated source text', async t => {
  const dirty = await prepared('A.cs', 'class A {}');
  const stable = await prepared('Stable.cs', 'class Stable {}');
  const {state, documents} = fixture(t, [dirty, stable]);
  dirty.model.applyEdits([{start: 0, end: 0, text: '// first\n'}]);
  const source = dirty.model.snapshot();
  const changes = collectNativeSourceChanges(state, documents);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, 'A.cs');
  assert.equal(changes[0].expectedHash, 'hash:A.cs');
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(stable.source.statistics.textMaterialized, false);
  dirty.model.applyEdits([{start: 0, end: 0, text: '// later\n'}]);
  assert.equal(changes[0].text, '// first\nclass A {}');
  assert.equal(stable.source.statistics.textMaterialized, false);
  assert.deepEqual(collectNativeSourceChanges({...state, nativeMode: false}, documents), []);
});

test('context cancellation and workspace replacement while execution stops cannot adopt sources', async t => {
  const original = await prepared('A.cs', 'class A {}');
  const {state, documents} = fixture(t, [original]);
  for (const kind of ['cancel', 'workspace']) {
    const controller = new AbortController();
    let release;
    const hooks = createNativeContextHooks({state, documents,
      stop: () => new Promise(resolve => { release = resolve; })});
    const selected = payload([{uri: 'B.cs', text: 'class B {}'}]);
    selected.signal = controller.signal;
    const pending = hooks.onProjectContext(selected);
    if (kind === 'cancel') controller.abort();
    else state.workspaceEpoch++;
    release();
    await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(documents.models.get('A.cs'), original.model);
    assert.equal(documents.get('B.cs'), null);
    assert.equal(state.nativeProjectContext, undefined);
  }
});

test('native refresh remaps prepared sources and retains unrelated dirty documents and project buffers', async t => {
  const original = await prepared('A.cs', 'class A {}');
  const other = await prepared('Other.cs', 'class Other {}');
  const {state, documents} = fixture(t, [original, other]);
  documents.open('A.cs');
  state.breakpoints = {'A.cs': [3], 'Other.cs': [8]};
  state.nativeContextFiles = ['A.cs'];
  other.model.applyEdits([{start: 0, end: 0, text: '// unsaved\n'}]);
  const unrelated = other.model.snapshot();
  const reads = [];
  const workspace = {root: '/native', files: [{path: 'Folder/Renamed.cs'}, {path: 'Other.cs'}]};
  const dirtyBuffer = {path: 'App.csproj', text: '<Project/>', baseline: '<Project />', hash: 'project'};
  const nativeBuild = {client: {async read(path, options) {
    reads.push({path, options});
    return {path, text: 'class A {}', hash: 'renamed'};
  }}, async refresh() { return workspace; },
  buffers: new Map([['App.csproj', dirtyBuffer], ['Clean.props', {text: '<Project/>', baseline: '<Project/>', hash: 'clean'}]]),
  sourcePath: 'App.csproj'};
  const controller = new AbortController();
  await refreshNativeExplorerWorkspace({state, documents, nativeBuild}, [{from: 'A.cs', to: 'Folder/Renamed.cs'}],
    {partial: true, signal: controller.signal});
  assert.deepEqual(reads.map(read => read.path), ['Folder/Renamed.cs']);
  assert.equal(reads[0].options.signal, controller.signal);
  assert.equal(documents.get('A.cs'), null);
  assert.equal(documents.get('Folder/Renamed.cs').model.uri, 'Folder/Renamed.cs');
  assert.equal(documents.get('Folder/Renamed.cs').dirty, false);
  assert.equal(documents.get('Folder/Renamed.cs').nativeHash, 'renamed');
  assert.throws(() => original.model.prepareEdits([]), /disposed/);
  assert.equal(documents.models.get('Other.cs'), other.model);
  assert.equal(documents.get('Other.cs').source, unrelated);
  assert.equal(documents.get('Other.cs').dirty, true);
  assert.equal(state.active, 'Folder/Renamed.cs');
  assert.deepEqual(state.tabs, ['Folder/Renamed.cs']);
  assert.deepEqual(state.breakpoints, {'Folder/Renamed.cs': [3], 'Other.cs': [8]});
  assert.deepEqual(state.nativeContextFiles, ['Folder/Renamed.cs']);
  assert.equal(nativeBuild.buffers.get('App.csproj'), dirtyBuffer);
  assert.equal(nativeBuild.buffers.has('Clean.props'), false);
  assert.equal(nativeBuild.sourcePath, 'App.csproj');
  assert.equal(unrelated.statistics.textMaterialized, false);
});

test('late native reads cannot replace edited documents or cross a changed client or workspace', async t => {
  for (const kind of ['edit', 'client', 'workspace', 'cancel']) {
    const original = await prepared('A.cs', 'class A {}');
    const {state, documents} = fixture(t, [original]);
    let release;
    let reading;
    const started = new Promise(resolve => { reading = resolve; });
    const controller = new AbortController();
    const nativeBuild = {client: {read(_path, {signal}) {
      assert.equal(signal, controller.signal);
      reading();
      return new Promise(resolve => { release = resolve; });
    }}, async refresh() { return {root: '/native', files: [{path: 'A.cs'}]}; }};
    const pending = refreshNativeExplorerWorkspace({state, documents, nativeBuild}, [], {signal: controller.signal});
    await started;
    if (kind === 'edit') original.model.applyEdits([{start: 0, end: 0, text: '// edit\n'}]);
    if (kind === 'client') nativeBuild.client = {};
    if (kind === 'workspace') state.workspaceEpoch++;
    if (kind === 'cancel') controller.abort();
    release({path: 'A.cs', text: 'class DiskChanged {}', hash: 'disk'});
    await assert.rejects(pending, {name: 'AbortError'});
    assert.equal(documents.models.get('A.cs'), original.model);
    assert.equal(documents.get('A.cs').nativeHash, 'hash:A.cs');
    assert.doesNotThrow(() => original.model.prepareEdits([]));
  }
});

test('a dirty native rename rebases document ownership while retaining its saved baseline and expected hash', async t => {
  const original = await prepared('A.cs', 'class A {}');
  const {state, documents} = fixture(t, [original]);
  original.model.applyEdits([{start: 0, end: 0, text: '// local\n'}]);
  const dirty = original.model.snapshot();
  const nativeBuild = {client: {async read() { return {text: 'class DiskA {}', hash: 'disk'}; }},
    async refresh() { return {root: '/native', files: [{path: 'B.cs'}]}; }};
  await refreshNativeExplorerWorkspace({state, documents, nativeBuild}, [{from: 'A.cs', to: 'B.cs'}]);
  const renamed = documents.get('B.cs');
  assert.equal(renamed.model.uri, 'B.cs');
  assert.equal(renamed.source.getText(0, renamed.source.length), '// local\nclass A {}');
  assert.equal(renamed.dirty, true);
  assert.equal(renamed.nativeHash, 'hash:A.cs');
  assert.equal(documents.baselines.get('B.cs').uri, 'B.cs');
  assert.equal(documents.baselines.get('B.cs').getText(0, original.source.length), 'class A {}');
  assert.equal(collectNativeSourceChanges(state, documents)[0].expectedHash, 'hash:A.cs');
  assert.throws(() => original.model.prepareEdits([]), /disposed/);
  assert.equal(dirty.statistics.textMaterialized, false);
});

test('committed native context observer errors retain the new owner and metadata', async t => {
  const original = await prepared('A.cs', 'class A {}');
  const {state, documents} = fixture(t, [original]);
  documents.subscribe(event => { if (event.type === 'reset') throw new Error('View update failed'); });
  assert.throws(() => applyNativeProjectContext(state, payload([{uri: 'A.cs', text: 'class NewA {}', hash: 'new'}]),
    {documents}), {code: 'DOCUMENT_COMMITTED', committed: true});
  const replacement = documents.get('A.cs');
  assert.notEqual(replacement.model, original.model);
  assert.equal(documents.ownsModel(replacement.model), true);
  assert.doesNotThrow(() => replacement.model.prepareEdits([]));
  assert.throws(() => original.model.prepareEdits([]), /disposed/);
  assert.equal(state.nativeProjectContext.id, 'native:net10');
  assert.equal(state.image, null);
});
