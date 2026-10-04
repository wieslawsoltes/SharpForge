import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderDiskWorkspace as DiskWorkspace} from '@sharpforge/project-system';
import {Workspace, hashFileBytes, migrateWorkspaceRecovery} from '@sharpforge/workspace';
import {admitWorkspaceSource} from '../apps/studio/workspace-documents.js';
import {releaseWorkspaceEditorView} from '../apps/studio/workspace-editor-lifecycle.js';
import {registerDocumentLifecycleHandlers, syncWorkerDocuments} from '../apps/studio/workers/document-lifecycle.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';
import {ExplorerPersistence} from '../apps/studio/explorer/persistence.js';
import {application, directoryFiles} from './support/workspace-application.js';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const encode = text => new TextEncoder().encode(text);

function removeTab(app, path) {
  app.state.tabs = app.state.tabs.filter(uri => uri !== path);
  if (app.state.active === path) app.state.active = app.state.tabs.at(-1) ?? '';
}

async function openTab(app, path) {
  const record = await app.session.loadRecord(path);
  admitWorkspaceSource(app.state, record);
  if (!app.state.tabs.includes(path)) app.state.tabs.push(path);
  app.state.active = path;
  return record;
}

async function loadedApplication(files = [['A.cs', 'class A {}']], options = {lazy: true}) {
  const app = application();
  const {disk, provider} = await directoryFiles(files, options);
  await app.session.load(disk.records, {disk, mode: 'folder'});
  let disposed = 0;
  app.host.editors.set('A.cs', {value: app.state.files[0]?.text, dispose() { disposed++; }});
  app.host.releaseDocumentView = path => releaseWorkspaceEditorView({editors: app.host.editors}, path);
  return {...app, disk, provider, disposed: () => disposed};
}

test('closing a clean source releases editor, host records, disk bytes and compiler syntax, then reads current physical bytes', async () => {
  const app = await loadedApplication();
  const worker = new Workspace();
  const handlers = new Map();
  registerDocumentLifecycleHandlers({registerHandler: (name, handle) => handlers.set(name, handle)}, {workspace: worker});
  const source = app.state.files[0];
  worker.update(source.uri, source.text, source.version);
  worker.syntax(source.uri);
  app.host.releaseCompilerDocuments = documents => handlers.get('releaseDocuments')({documents});
  const baseline = app.disk.baselineHashes.get('A.cs');
  removeTab(app, 'A.cs');
  const result = await app.session.closeRecord('A.cs');
  assert.equal(result.evicted, true);
  assert.equal(app.disposed(), 1);
  assert.equal(app.host.editors.size, 0);
  assert.equal(app.state.files.length, 0);
  assert.equal(app.disk.loadedBytes, 0);
  assert.equal(app.disk.baseline.get('A.cs'), undefined);
  assert.equal(app.disk.baselineHashes.get('A.cs'), baseline);
  assert.equal(app.host.context().records[0].lazy, true);
  assert.equal(app.host.context().records[0].text, undefined);
  assert.equal(worker.documents.size, 0);
  assert.equal(worker.loadedDocumentBytes, 0);
  assert.equal(app.state.dirtyFiles.size, 0);
  await app.provider.writeFile('A.cs', encode('class Current {}'));
  const reopened = await openTab(app, 'A.cs');
  assert.equal(reopened.text, 'class Current {}');
  assert(reopened.version > source.version);
  assert.equal(worker.update('A.cs', reopened.text, reopened.version), true);
  assert.equal(worker.documents.get('A.cs').parsed, null);
});

test('closing project source preserves evaluated membership and keeps only lazy source metadata in the project system', async () => {
  const app = application();
  const {disk} = await directoryFiles([['App.csproj', '<Project Sdk="Microsoft.NET.Sdk"/>'], ['A.cs', 'class A {}']], {lazy: true});
  await app.session.load(disk.records, {disk, entry: 'App.csproj'});
  removeTab(app, 'A.cs');
  assert.equal((await app.session.closeRecord('A.cs')).evicted, true);
  const record = app.state.projectSystem.files.get('A.cs');
  assert.equal(record.lazy, true);
  assert.equal(record.text, undefined);
  assert.equal(app.state.projectSystem.projects.get('App.csproj').compile.some(file => file.path === 'A.cs'), true);
  assert.equal(app.state.membershipDirty, false);
  assert.equal((await openTab(app, 'A.cs')).text, 'class A {}');
});

test('5000 metadata files keep at most one opened buffer and no closed editor or disk contents across repeated opens', async () => {
  const provider = new DelayedProvider();
  const records = Array.from({length: 5000}, (_, index) => ({path: 'F' + index + '.cs', size: 12, lazy: true}));
  for (let index = 0; index < records.length; index++) await provider.writeFile(records[index].path, encode('class F' + index + ' {}'));
  const disk = new DiskWorkspace(records, new Map(), 'Many', [], [], {provider, maxTotalBytes: 128});
  const app = application();
  await app.session.load(records, {disk, mode: 'folder'});
  for (let index = 0; index < 40; index++) {
    const path = records[index].path;
    await openTab(app, path);
    assert.equal(app.state.files.length, 1);
    assert(disk.loadedBytes <= 128);
    removeTab(app, path);
    assert.equal((await app.session.closeRecord(path)).evicted, true);
    assert.equal(app.state.files.length, 0);
    assert.equal(disk.loadedBytes, 0);
  }
  assert.equal(app.host.context().records.length, 5000);
  assert(app.host.context().records.every(record => record.lazy && record.text === undefined && record.bytes === undefined));
  assert.equal(provider.reads, 40);
});

test('dirty, generated, read-only recovery, unresolved-conflict, unbacked and open documents retain their contents', async () => {
  for (const scenario of ['dirty', 'generated', 'read-only', 'conflict', 'unbacked', 'open', 'busy']) {
    const app = await loadedApplication();
    if (scenario !== 'open') removeTab(app, 'A.cs');
    if (scenario === 'dirty') app.edit('A.cs', 'class Unsaved {}');
    if (scenario === 'generated') app.state.files[0].generated = true;
    if (scenario === 'read-only') app.state.recoveryReadOnly = true;
    if (scenario === 'conflict') app.host.canReleaseDocument = () => false;
    if (scenario === 'busy') app.state.saveBusy = true;
    if (scenario === 'unbacked') {
      app.state.disk = new DiskWorkspace(app.disk.records.map(record => ({...record})));
    }
    const before = app.state.files[0].text;
    const result = await app.session.closeRecord('A.cs');
    assert.equal(result.evicted, false, scenario);
    assert.equal(app.state.files[0].text, before, scenario);
    assert.equal(app.disk.record('A.cs').lazy, false, scenario);
    assert.equal(app.disposed(), 0, scenario);
  }
});

test('unmarked edits fail exact-byte baseline comparison and remain recoverable', async () => {
  const app = await loadedApplication();
  app.state.files[0].text = 'class Unmarked {}';
  removeTab(app, 'A.cs');
  assert.equal((await app.session.closeRecord('A.cs')).reason, 'modified');
  assert.equal(app.state.files[0].text, 'class Unmarked {}');
  assert.equal(app.disposed(), 0);
});

test('read-only and generated source flags survive workspace load, context snapshots and transactional commits', async () => {
  const app = application();
  const {disk} = await directoryFiles([['A.cs', 'class A {}']]);
  const records = disk.records.map(record => ({...record, readOnly: true, generated: true}));
  const recovered = migrateWorkspaceRecovery({records});
  assert.equal(recovered.records[0].readOnly, true);
  assert.equal(recovered.records[0].generated, true);
  await app.session.load(recovered.records, {disk, mode: 'folder'});
  assert.equal(app.state.files[0].readOnly, true);
  assert.equal(app.state.files[0].generated, true);
  assert.equal(app.host.context().records[0].readOnly, true);
  assert.equal(app.host.context().records[0].generated, true);
  await app.session.commit({records: app.host.context().records, preserveMembership: true});
  assert.equal(app.state.files[0].readOnly, true);
  assert.equal(app.state.files[0].generated, true);
  removeTab(app, 'A.cs');
  assert.equal((await app.session.closeRecord('A.cs')).evicted, false);
});

test('reopening or editing during the close digest prevents stale eviction', async () => {
  for (const change of ['reopen', 'edit', 'switch']) {
    const app = await loadedApplication();
    const digest = Promise.withResolvers();
    const started = Promise.withResolvers();
    app.host.hashDocumentBytes = async bytes => { started.resolve(); await digest.promise; return hashFileBytes(bytes); };
    removeTab(app, 'A.cs');
    const closing = app.session.closeRecord('A.cs');
    await started.promise;
    if (change === 'reopen') { app.session.retainRecord('A.cs'); app.state.tabs.push('A.cs'); }
    if (change === 'edit') app.edit('A.cs', 'class NewEdit {}');
    if (change === 'switch') app.state.workspaceEpoch++;
    digest.resolve();
    assert.equal((await closing).evicted, false, change);
    assert.equal(app.disposed(), 0, change);
    assert.equal(app.state.files.length, 1, change);
  }
});

test('close cancels a delayed lazy read before disk or host publication; a later open wins', async () => {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', encode('class Before {}'));
  await provider.writeFile('Other.cs', encode('class Other {}'));
  const records = ['Other.cs', 'A.cs'].map(path => ({path, size: 15, lazy: true}));
  const disk = new DiskWorkspace(records, new Map(), 'Race', [], [], {provider});
  const app = application();
  await app.session.load(records, {disk, mode: 'folder'});
  const gate = provider.pause('read');
  const pending = app.session.loadRecord('A.cs');
  await gate.entered;
  removeTab(app, 'A.cs');
  await app.session.closeRecord('A.cs');
  await provider.writeFile('A.cs', encode('class After {}'));
  const current = await openTab(app, 'A.cs');
  gate.release();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(current.text, 'class After {}');
  assert.equal(disk.record('A.cs').text, 'class After {}');
  assert.equal(app.host.context().records.find(record => record.path === 'A.cs').text, 'class After {}');
});

test('workspace replacement, membership change and abort reject a delayed load without advancing physical baselines', async () => {
  for (const change of ['workspace', 'member', 'abort']) {
    const provider = new DelayedProvider();
    await provider.writeFile('A.cs', encode('class A {}'));
    await provider.writeFile('Other.cs', encode('class Other {}'));
    const records = ['Other.cs', 'A.cs'].map(path => ({path, size: 10, lazy: true}));
    const disk = new DiskWorkspace(records, new Map(), 'Race', [], [], {provider});
    const app = application();
    await app.session.load(records, {disk, mode: 'folder'});
    const gate = provider.pause('handle');
    const controller = new AbortController();
    const pending = app.session.loadRecord('A.cs', {signal: controller.signal});
    await gate.entered;
    if (change === 'workspace') app.state.workspaceEpoch++;
    if (change === 'member') app.state.extraFiles = app.state.extraFiles.filter(record => record.path !== 'A.cs');
    if (change === 'abort') controller.abort();
    gate.release();
    await assert.rejects(pending, change === 'abort' ? {name: 'AbortError'} : /Workspace changed/);
    assert.equal(disk.record('A.cs').lazy, true, change);
    assert.equal(disk.baselineHashes.has('A.cs'), false, change);
    assert.equal(app.state.files.some(file => file.uri === 'A.cs'), false, change);
  }
});

test('disk admission callbacks are synchronous and a rejected callback cannot publish bytes, hashes or handles', async () => {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', encode('class A {}'));
  const disk = new DiskWorkspace([{path: 'A.cs', size: 10, version: 9, lazy: true}], new Map(), 'Guard', [], [], {provider});
  await assert.rejects(disk.load('A.cs', {beforeAdmit() { throw new Error('stale editor'); }}), /stale editor/);
  assert.equal(disk.record('A.cs').lazy, true);
  assert.equal(disk.loadedBytes, 0);
  assert.equal(disk.baselineHashes.size, 0);
  assert.equal(disk.handles.size, 0);
  await assert.rejects(disk.load('A.cs', {beforeAdmit: async () => {}}), /synchronous/);
  await assert.rejects(disk.load('A.cs', {beforeAdmit: () => Promise.reject(new Error('invalid async guard'))}), /synchronous/);
  const record = await disk.load('A.cs');
  assert.equal(record.version, 10);
  disk.unload('A.cs');
  assert.deepEqual(Object.keys(disk.record('A.cs')).toSorted(), ['lazy', 'path', 'size', 'version']);
  assert.equal((await disk.load('A.cs')).version, 11);
});

test('exhausted versions and pre-aborted closes retain the last usable bytes', async () => {
  const app = await loadedApplication();
  removeTab(app, 'A.cs');
  await assert.rejects(app.session.closeRecord('A.cs', {signal: AbortSignal.abort()}), {name: 'AbortError'});
  app.state.files[0].version = Number.MAX_SAFE_INTEGER;
  assert.equal((await app.session.closeRecord('A.cs')).reason, 'version-limit');
  assert.equal(app.state.files[0].text, 'class A {}');
  assert.equal(app.disposed(), 0);
});

test('versioned worker eviction rejects malformed batches atomically and never removes a newer reopened document', () => {
  const workspace = new Workspace();
  const handlers = createWorkerProtocol('compiler');
  registerDocumentLifecycleHandlers(handlers, {workspace});
  const release = params => handlers.dispatch('releaseDocuments', params);
  workspace.update('A.cs', 'class A {}', 3);
  workspace.syntax('A.cs');
  assert.throws(() => release({documents: [{uri: 'A.cs', version: 3}, {uri: '', version: 1}]}), /document/i);
  assert.equal(workspace.documents.size, 1);
  assert.deepEqual(release({documents: [{uri: 'A.cs', version: 2}]}).released, []);
  assert.equal(workspace.documents.size, 1);
  assert.deepEqual(release({documents: [{uri: 'A.cs', version: 3}]}).released, ['A.cs']);
  workspace.update('A.cs', 'class Reopened {}', 4);
  assert.deepEqual(release({documents: [{uri: 'A.cs', version: 3}]}).released, []);
  assert.equal(workspace.documents.get('A.cs').source.text, 'class Reopened {}');
  assert.throws(() => release({documents: Array(20001).fill({uri: 'A.cs', version: 4})}), /limit/i);
});

test('worker synchronization preserves no-op requests, removes absent documents, and accepts only newer source versions', () => {
  const workspace = new Workspace();
  workspace.update('A.cs', 'class A {}', 2);
  syncWorkerDocuments(workspace);
  assert.equal(workspace.documents.size, 1);
  syncWorkerDocuments(workspace, [{uri: 'A.cs', text: 'class Stale {}', version: 1}]);
  assert.equal(workspace.documents.get('A.cs').source.text, 'class A {}');
  syncWorkerDocuments(workspace, [{uri: 'B.cs', text: 'class B {}', version: 1}]);
  assert.deepEqual([...workspace.documents.keys()], ['B.cs']);
  syncWorkerDocuments(workspace, []);
  assert.equal(workspace.documents.size, 0);
});

test('closed editor views release both docking content maps, while visible splits and popouts stay intact', () => {
  let disposed = 0, removed = 0, released = 0;
  const editor = {dispose() { disposed++; }};
  const node = {remove() { removed++; }};
  const editors = new Map([['A.cs', editor]]);
  const docking = {content: new Map([['source:A.cs', node]]), layout: {locate: () => ({kind: 'closed'})},
    host: {contents: new Map([['source:A.cs', node]]), popouts: new Map()}};
  docking.host.popouts.set('source:A.cs', {});
  assert.equal(releaseWorkspaceEditorView({editors, docking}, 'A.cs'), false);
  docking.host.popouts.clear();
  assert.equal(releaseWorkspaceEditorView({editors, docking, onReleased: value => { assert.equal(value, editor); released++; }}, 'A.cs'), true);
  assert.equal(disposed, 1);
  assert.equal(removed, 1);
  assert.equal(released, 1);
  assert.equal(editors.size, 0);
  assert.equal(docking.content.size, 0);
  assert.equal(docking.host.contents.size, 0);
});

test('Explorer drops closed source bodies and merge baselines, retaining a numeric revision watermark and rejecting stale queue contents', async () => {
  let data = {identity: 'one', name: 'One', records: [{path: 'A.cs', text: 'class A {}', version: 7}], tabs: ['A.cs'], dirty: []};
  const persistence = new ExplorerPersistence({getData: () => data, environment: {}});
  try {
    persistence.observe(data);
    await persistence.revisionQueue;
    const previous = persistence.documents.get('A.cs').revision;
    const stale = data;
    data = {...data, records: [{path: 'A.cs', size: 10, version: 7, lazy: true}], tabs: []};
    assert.equal(persistence.releaseDocument('A.cs'), true);
    await persistence.updateRevisions(stale, persistence.generation);
    assert.equal(persistence.documents.get('A.cs').content, undefined);
    assert.equal(persistence.documents.get('A.cs').text, undefined);
    assert.equal(persistence.baselines.has('A.cs'), false);
    assert.equal(persistence.documentFor('A.cs'), null);
    data = {...data, records: [{path: 'A.cs', text: 'class Reloaded {}', version: 8}], tabs: ['A.cs']};
    persistence.observe(data);
    await persistence.revisionQueue;
    assert(persistence.documents.get('A.cs').revision > previous);
    assert.equal(persistence.documents.get('A.cs').text, 'class Reloaded {}');
  } finally { persistence.dispose(); }
});
