import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentEvents } from '../apps/studio/services/documents.js';
import { applyStudioTextEdits } from '../apps/studio/services/edits.js';
import { gitExplorerItems } from '../apps/studio/git-explorer-overlay.js';
import { formatGitStatus } from '../apps/studio/git-status-bar.js';
import { cloneOptions } from '../apps/studio/git-clone-dialog.js';
import { restoreStudioDebugSources } from '../apps/studio/services/edits.js';
import { commitStudioWorkspaceRecords, refreshNativeStudioExplorer } from '../apps/studio/services/workspace-records.js';
import { createEditorAnnotations } from '../apps/studio/services/annotations.js';

test('document notifications observe completed edit transactions and subscriptions dispose independently', () => {
  const documents = createDocumentEvents();
  const observed = [];
  const state = { files: [{ uri: 'first.cs', text: 'abcd', version: 1 }, { uri: 'second.cs', text: 'other', version: 2 }],
    breakpoints: {}, dirtyFiles: new Set(), revision: 1, diskRevision: 1 };
  const stop = documents.subscribe(event => observed.push({ ...event, dirty: state.dirtyFiles.has(event.uri) }));
  const effects = [];
  applyStudioTextEdits({ state, editors: new Map(), remapSourceBreakpoints: (_, __, values) => values,
    renderWorkspace: () => effects.push('render'), saveLocal: () => effects.push('save'), analyze: () => effects.push('analyze'),
    documentEvents: documents }, [{ uri: 'first.cs', start: 1, end: 3, newText: 'XY' }]);
  assert.equal(state.files[0].text, 'aXYd');
  assert.equal(state.files[0].version, 2);
  assert.equal(state.files[1].text, 'other');
  assert.equal(state.applyingEdits, false);
  assert.deepEqual(effects, ['render', 'save', 'analyze']);
  assert.deepEqual(observed, [{ uri: 'first.cs', text: 'aXYd', dirty: true }]);
  stop();
  documents.publish('first.cs', 'later');
  assert.equal(observed.length, 1);
  documents.dispose();
  assert.throws(() => documents.subscribe(() => {}), /disposed/);
});

test('explorer contributions use exact selected file paths and exclude folders', async () => {
  const calls = [];
  const workbench = { run: action => action({}), synchronize: async () => calls.push('sync'),
    request: async (method, value) => calls.push([method, value]), host: { showPanel: id => calls.push(id) } };
  const items = gitExplorerItems({ path: 'folder', branch: true }, [
    { path: 'first.cs' }, { path: 'first.cs' }, { path: 'folder', branch: true }, { path: 'second.cs' }
  ], action => action(workbench));
  await items[1].children[0].action();
  assert.deepEqual(calls, ['sync', ['add', { paths: ['first.cs', 'second.cs'] }]]);
  assert.deepEqual(gitExplorerItems({ path: 'folder', branch: true }, [], () => {}), []);
});

test('status indicator includes actual branch, changed paths and upstream counts', () => {
  assert.equal(formatGitStatus({ branch: 'feature', changes: [{ path: 'a' }], aheadBehind: { ahead: 2, behind: 3 } }),
    '⑂ feature · 1 · ↑2 ↓3');
  assert.equal(formatGitStatus(), '⑂ Git');
});

test('clone options reject unsafe URLs and non-integral depths before repository effects', () => {
  const options = { url: 'https://github.com/example/repository.git', depth: '0', branch: '', filter: '' };
  assert.deepEqual(cloneOptions(options), { url: options.url, depth: undefined, branch: undefined, filter: undefined });
  assert.equal(cloneOptions({ ...options, depth: '12', filter: 'blob:none' }).depth, 12);
  for (const depth of ['-1', '1.5', 'Infinity', 'not-a-number']) assert.throws(() => cloneOptions({ ...options, depth }));
  assert.throws(() => cloneOptions({ ...options, url: 'https://secret@example.test/repo' }), { code: 'Unsafe' });
  assert.throws(() => cloneOptions({ ...options, filter: 'tree:99' }));
});

function workspaceHost(files) {
  const documentEvents = createDocumentEvents();
  const state = { files, extraFiles: [], folders: [], workspaceMode: 'folder', tabs: files.map(file => file.uri),
    active: files[0]?.uri, breakpoints: {}, dirtyFiles: new Set(), revision: 1, diskRevision: 1 };
  const events = [];
  documentEvents.subscribe(event => events.push({ ...event, applying: !!state.applyingEdits,
    current: state.files.find(file => file.uri === event.uri)?.text }));
  return { state, documentEvents, events, editors: new Map(), renderWorkspace() {}, saveLocal() {},
    scheduleAnalysis() {}, renderTabs() {} };
}

test('browser workspace replacement emits changed and removed sources only after the model transaction', async () => {
  const host = workspaceHost([{ uri: 'keep.cs', text: 'same', version: 1 },
    { uri: 'edit.cs', text: 'old', version: 1 }, { uri: 'delete.cs', text: 'removed', version: 1 }]);
  await commitStudioWorkspaceRecords(host, { records: [
    { path: 'keep.cs', text: 'same' }, { path: 'edit.cs', text: 'new' }, { path: 'add.cs', text: 'created' }
  ] });
  assert.deepEqual(host.events, [
    { uri: 'edit.cs', text: 'new', applying: false, current: 'new' },
    { uri: 'add.cs', text: 'created', applying: false, current: 'created' },
    { uri: 'delete.cs', text: undefined, applying: false, current: undefined }
  ]);
  assert.equal(host.state.dirtyFiles.has('edit.cs'), true);
  const before = host.state.files;
  await assert.rejects(commitStudioWorkspaceRecords(host, { records: [{ path: '../escape.cs', text: 'unsafe' }] }));
  assert.equal(host.state.files, before);
  assert.equal(host.events.length, 3);
});

test('debug restoration and native refresh notify source replacement while retaining dirty native buffers', async () => {
  const host = workspaceHost([{ uri: 'first.cs', text: 'edited', nativeBaseline: 'old', version: 1 },
    { uri: 'second.cs', text: 'baseline', nativeBaseline: 'baseline', version: 1 },
    { uri: 'removed.cs', text: 'gone', nativeBaseline: 'gone', version: 1 }]);
  host.nativeBuild = { refresh: async () => ({ files: [{ path: 'first.cs' }, { path: 'second.cs' }] }),
    client: { read: async () => ({ text: 'disk', hash: 'native-hash' }) }, buffers: new Map(), renderSource() {} };
  await refreshNativeStudioExplorer(host);
  assert.equal(host.state.files[0].text, 'edited');
  assert.deepEqual(host.events.map(({ uri, text }) => ({ uri, text })), [
    { uri: 'second.cs', text: 'disk' }, { uri: 'removed.cs', text: undefined }
  ]);
  restoreStudioDebugSources(host, [{ uri: 'first.cs', text: 'restored' }]);
  assert.deepEqual(host.events.at(-1), { uri: 'first.cs', text: 'restored', applying: false, current: 'restored' });
  assert.equal(host.state.buildDirty, false);
});

test('owned editor annotations compose with stable source identity and clear only their contribution', () => {
  const annotations = createEditorAnnotations();
  const changes = [];
  const unsubscribe = annotations.subscribe(uri => changes.push(uri));
  annotations.set('git-review', 'first.cs', [{ message: 'Review comment', source: 'forged', uri: 'wrong.cs', severity: 'info' }]);
  annotations.set('other-tool', 'first.cs', [{ message: 'Independent diagnostic' }]);
  annotations.set('git-review', 'second.cs', [{ message: 'Other file comment' }]);
  const first = annotations.get('first.cs');
  assert.equal(annotations.get('first.cs'), first);
  assert.equal(first[0].source, 'git-review');
  assert.equal(first[0].uri, 'first.cs');
  assert.throws(() => first.push({ message: 'Mutable' }), TypeError);
  annotations.clear('git-review', 'first.cs');
  assert.deepEqual(annotations.get('first.cs').map(item => item.message), ['Independent diagnostic']);
  assert.equal(annotations.get('second.cs').length, 1);
  annotations.clear('git-review');
  assert.equal(annotations.get('second.cs').length, 0);
  assert.equal(changes.length, 5);
  unsubscribe();
  annotations.dispose();
  assert.deepEqual(annotations.get('first.cs'), []);
  assert.throws(() => annotations.set('git-review', 'first.cs', []), /disposed/);
});
