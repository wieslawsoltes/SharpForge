import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderDiskWorkspace} from '@sharpforge/project-system';
import {Workspace, hashFileBytes} from '@sharpforge/workspace';
import {decodeWorkspaceFile} from '@sharpforge/archive';
import {createWorkspaceEditorLifecycle, releaseWorkspaceEditorView} from '../apps/studio/workspace-editor-lifecycle.js';
import {registerDocumentLifecycleHandlers, syncWorkerDocuments} from '../apps/studio/workers/document-lifecycle.js';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const encode = text => new TextEncoder().encode(text);

async function fixture({lazy = false} = {}) {
  const provider = new DelayedProvider();
  const bytes = encode('class A {}');
  await provider.writeFile('A.cs', bytes);
  const record = lazy ? {path: 'A.cs', size: bytes.length, lazy: true, version: 7}
    : {...decodeWorkspaceFile('A.cs', bytes), version: 7};
  const disk = new ProviderDiskWorkspace([record], new Map(), 'Fixture', [], [], {provider});
  await disk.initializeBaselines();
  const state = {identity: 'workspace', revision: 1, disk, files: lazy ? [] : [{uri: 'A.cs', text: record.text, version: 7}],
    extraFiles: [{...record}], tabs: [], dirtyFiles: new Set(), active: ''};
  const events = [];
  const editors = new Map([['A.cs', {dispose: () => events.push('dispose')}] ]);
  const host = {state, editors, saveLocal: () => events.push('save'), renderDocuments: () => events.push('render'),
    context: () => ({identity: state.identity, revision: state.revision, disk: state.disk, fileBusy: state.fileBusy,
      native: state.native, dirty: [...state.dirtyFiles], records: state.extraFiles.map(record => {
        const source = state.files.find(file => file.uri === record.path);
        return source ? {...record, ...source} : record;
      })}), releaseDocumentView: path => releaseWorkspaceEditorView({editors}, path)};
  return {provider, disk, state, host, events, lifecycle: createWorkspaceEditorLifecycle(host)};
}

test('clean closed buffers release editor, disk bytes and compiler syntax, then reopen current bytes with a newer version', async () => {
  const app = await fixture();
  const worker = new Workspace();
  const handlers = new Map();
  registerDocumentLifecycleHandlers({registerHandler: (id, handler) => handlers.set(id, handler)}, {workspace: worker});
  worker.update('A.cs', app.state.files[0].text, 7);
  worker.syntax('A.cs');
  app.host.releaseCompilerDocuments = documents => handlers.get('releaseDocuments')({documents});
  const baseline = app.disk.baselineHashes.get('A.cs');
  const result = await app.lifecycle.closeRecord('A.cs');
  assert.equal(result.evicted, true);
  assert.equal(app.host.editors.size, 0);
  assert.equal(app.state.files.length, 0);
  assert.equal(app.disk.loadedBytes, 0);
  assert.equal(app.disk.baselineHashes.get('A.cs'), baseline);
  assert.equal(app.disk.record('A.cs').text, undefined);
  assert.equal(app.state.extraFiles[0].lazy, true);
  assert.equal(worker.documents.size, 0);
  assert.equal(worker.loadedDocumentBytes, 0);
  await app.provider.writeFile('A.cs', encode('class Current {}'));
  const reopened = await app.lifecycle.loadRecord('A.cs');
  assert.equal(reopened.text, 'class Current {}');
  assert(reopened.version > 7);
  assert.equal(app.state.extraFiles[0].text, 'class Current {}');
  assert.equal(worker.update('A.cs', reopened.text, reopened.version), true);
  assert.equal(worker.documents.get('A.cs').parsed, null);
  app.lifecycle.dispose();
});

test('dirty, generated, read-only, conflicted, unbacked, busy and visible records retain the last usable source', async () => {
  for (const scenario of ['dirty', 'generated', 'read-only', 'conflict', 'unbacked', 'busy', 'tab', 'detached']) {
    const app = await fixture();
    if (scenario === 'dirty') app.state.dirtyFiles.add('A.cs');
    if (scenario === 'generated') app.state.files[0].generated = true;
    if (scenario === 'read-only') app.state.recoveryReadOnly = true;
    if (scenario === 'conflict') app.host.canReleaseDocument = () => false;
    if (scenario === 'unbacked') app.disk.options.provider = undefined;
    if (scenario === 'busy') app.state.fileBusy = true;
    if (scenario === 'tab') app.state.tabs.push('A.cs');
    if (scenario === 'detached') app.host.isDocumentOpen = () => true;
    assert.equal((await app.lifecycle.closeRecord('A.cs')).evicted, false, scenario);
    assert.equal(app.state.files[0].text, 'class A {}', scenario);
    assert.equal(app.disk.record('A.cs').text, 'class A {}', scenario);
    assert.equal(app.events.includes('dispose'), false, scenario);
    app.lifecycle.dispose();
  }
});

test('edits, reopened tabs and workspace replacement during a close digest cannot evict newer state', async () => {
  for (const change of ['edit', 'reopen', 'workspace']) {
    const app = await fixture();
    const started = Promise.withResolvers(), finish = Promise.withResolvers();
    app.host.hashDocumentBytes = async bytes => { started.resolve(); await finish.promise; return hashFileBytes(bytes); };
    const pending = app.lifecycle.closeRecord('A.cs');
    await started.promise;
    if (change === 'edit') { app.state.files[0].text = 'class Edited {}'; app.state.files[0].version++; }
    if (change === 'reopen') { app.lifecycle.retainRecord('A.cs'); app.state.tabs.push('A.cs'); }
    if (change === 'workspace') app.state.identity = 'replacement';
    finish.resolve();
    assert.equal((await pending).evicted, false, change);
    assert.equal(app.state.files.length, 1, change);
    assert.equal(app.events.includes('dispose'), false, change);
    app.lifecycle.dispose();
  }
});

test('closing a delayed lazy read cancels its admission; a newer open publishes the current provider bytes', async () => {
  const app = await fixture({lazy: true});
  const gate = app.provider.pause('read');
  const pending = app.lifecycle.loadRecord('A.cs');
  await gate.entered;
  assert.equal((await app.lifecycle.closeRecord('A.cs')).reason, 'unloaded');
  await app.provider.writeFile('A.cs', encode('class Newer {}'));
  const reopened = await app.lifecycle.loadRecord('A.cs');
  gate.release();
  await assert.rejects(pending, {code: 'Cancelled'});
  assert.equal(reopened.text, 'class Newer {}');
  assert.equal(app.disk.record('A.cs').text, 'class Newer {}');
  assert.equal(app.state.extraFiles[0].text, 'class Newer {}');
  app.lifecycle.dispose();
});

test('membership changes during handle resolution and disposed reads cannot publish bytes or baselines', async () => {
  for (const change of ['membership', 'dispose']) {
    const app = await fixture({lazy: true});
    const gate = app.provider.pause('handle');
    const pending = app.lifecycle.loadRecord('A.cs');
    await gate.entered;
    if (change === 'membership') app.state.extraFiles = [];
    else app.lifecycle.dispose();
    gate.release();
    await assert.rejects(pending, {code: change === 'membership' ? 'Conflict' : 'Cancelled'});
    assert.equal(app.disk.record('A.cs').lazy, true, change);
    assert.equal(app.disk.loadedBytes, 0, change);
    assert.equal(app.disk.baselineHashes.size, 0, change);
    assert.equal(app.disk.handles.size, 0, change);
    app.lifecycle.dispose();
  }
});

test('unmarked edits, exhausted versions and pre-aborted closes retain source contents', async () => {
  const app = await fixture();
  app.state.files[0].text = 'class Unmarked {}';
  assert.equal((await app.lifecycle.closeRecord('A.cs')).reason, 'modified');
  app.state.files[0].text = 'class A {}';
  app.state.files[0].version = Number.MAX_SAFE_INTEGER;
  assert.equal((await app.lifecycle.closeRecord('A.cs')).reason, 'version-limit');
  await assert.rejects(app.lifecycle.closeRecord('A.cs', {signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(app.state.files.length, 1);
  assert.equal(app.events.includes('dispose'), false);
  app.lifecycle.dispose();
});

test('worker eviction validates the complete bounded batch and ignores stale close versions after reopening', () => {
  const workspace = new Workspace();
  const handlers = new Map();
  registerDocumentLifecycleHandlers({registerHandler: (id, handler) => handlers.set(id, handler)}, {workspace});
  const release = documents => handlers.get('releaseDocuments')({documents});
  workspace.update('A.cs', 'class A {}', 3);
  assert.throws(() => release([{uri: 'A.cs', version: 3}, {uri: '', version: 1}]), /document/i);
  assert.equal(workspace.documents.size, 1);
  assert.throws(() => release(Array(20001).fill({uri: 'A.cs', version: 3})), /limit/i);
  assert.deepEqual(release([{uri: 'A.cs', version: 2}]).released, []);
  assert.deepEqual(release([{uri: 'A.cs', version: 3}]).released, ['A.cs']);
  workspace.update('A.cs', 'class Reopened {}', 4);
  assert.deepEqual(release([{uri: 'A.cs', version: 3}]).released, []);
  syncWorkerDocuments(workspace);
  assert.equal(workspace.documents.get('A.cs').source.version, 4);
  syncWorkerDocuments(workspace, [{uri: 'A.cs', text: 'class Stale {}', version: 1}]);
  assert.equal(workspace.documents.get('A.cs').source.text, 'class Reopened {}');
  syncWorkerDocuments(workspace, [{uri: 'B.cs', text: 'class B {}', version: 1}]);
  assert.deepEqual([...workspace.documents.keys()], ['B.cs']);
  syncWorkerDocuments(workspace, []);
  assert.equal(workspace.documents.size, 0);
});

test('closed views clear both docking caches while visible split and detached views remain open', () => {
  let disposed = 0, removed = 0;
  const editors = new Map([['A.cs', {dispose() { disposed++; }}]]);
  const node = {remove() { removed++; }};
  let kind = 'group';
  const docking = {content: new Map([['source:A.cs', node]]), layout: {locate: () => ({kind})},
    host: {contents: new Map([['source:A.cs', node]]), popouts: new Map()}};
  assert.equal(releaseWorkspaceEditorView({editors, docking}, 'A.cs'), false);
  kind = 'closed';
  docking.host.popouts.set('source:A.cs', {});
  assert.equal(releaseWorkspaceEditorView({editors, docking}, 'A.cs'), false);
  docking.host.popouts.clear();
  assert.equal(releaseWorkspaceEditorView({editors, docking}, 'A.cs'), true);
  assert.equal(disposed, 1);
  assert.equal(removed, 1);
  assert.equal(editors.size, 0);
  assert.equal(docking.content.size, 0);
  assert.equal(docking.host.contents.size, 0);
});
