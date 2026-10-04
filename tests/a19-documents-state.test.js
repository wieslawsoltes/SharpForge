import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { createWorkspaceState, workspaceStateFields } from '../apps/studio/workbench/state.js';
import { SessionManager } from '../apps/studio/workbench/session-manager.js';
import { DocumentLocks } from '../apps/studio/workbench/document-locks.js';
import { fakeWorkers, fakeRuntime, deferred } from './a19-session-fixtures.js';

const records = () => [{ uri: 'A.cs', text: 'alpha', version: 1 }, { uri: 'B.cs', text: 'beta', version: 1 }];

test('documents open, change, save and close without requiring a docking host', async () => {
  const documents = new DocumentService({ records: records(), saveDocument: async () => true });
  const events = [];
  documents.subscribe(event => events.push(event.type));
  documents.open('A.cs');
  documents.update('A.cs', 'changed', { version: 1 });
  assert.equal(documents.get('A.cs').version, 2);
  assert.deepEqual(documents.tabs, ['A.cs']);
  assert.equal(documents.active, 'A.cs');
  assert.equal(documents.dirtyFiles.has('A.cs'), true);
  assert.throws(() => documents.close('A.cs'), { code: 'DOCUMENT_DIRTY' });
  assert.throws(() => documents.update('A.cs', 'stale', { version: 1 }), { code: 'DOCUMENT_STALE' });
  await documents.save('A.cs');
  documents.close('A.cs');
  assert.equal(documents.get('A.cs').text, 'changed');
  assert.deepEqual(documents.tabs, []);
  assert.equal(documents.active, '');
  assert.ok(events.includes('opened') && events.includes('dirty') && events.includes('saved') && events.includes('closed'));
  documents.dispose();
});

test('saving a captured revision never marks a newer edit as clean', async () => {
  const pending = deferred();
  const documents = new DocumentService({ records: records(), saveDocument: () => pending.promise });
  documents.update('A.cs', 'first edit');
  const saving = documents.save('A.cs');
  documents.update('A.cs', 'second edit');
  pending.resolve(true);
  assert.equal(await saving, false);
  assert.equal(documents.dirtyFiles.has('A.cs'), true);
  documents.close('A.cs', { discard: true });
  assert.equal(documents.get('A.cs').text, 'first edit');
  documents.dispose();
});

test('multiple document views share edits and retain independent selection/scroll state', () => {
  const created = [];
  const documents = new DocumentService({ records: records(), createEditor: (record, context) => {
    const editor = {
      element: {}, value: record.text, disposed: false,
      input: { selectionStart: 0, selectionEnd: 0, scrollTop: 0, scrollLeft: 0,
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } },
      setValue(text) { this.value = text; context.onChange(text); },
      setModel(uri, text) { this.value = text; },
      dispose() { this.disposed = true; }
    };
    created.push(editor);
    return editor;
  } });
  documents.createDocument('A.cs');
  documents.createDocument('A.cs', { viewId: 'split' });
  created[0].setValue('synchronized');
  assert.equal(created[1].value, 'synchronized');
  assert.equal(documents.get('A.cs').version, 2);
  documents.restoreViewState('A.cs', { selectionStart: 3, selectionEnd: 7, scrollTop: 80 }, 'split');
  assert.equal(documents.getViewState('A.cs', 'split').start, 3);
  assert.equal(documents.getViewState('A.cs').start, 0);
  documents.close('A.cs', { discard: true });
  assert.equal(created.every(editor => editor.disposed), true);
  documents.dispose();
});

test('workspace replacement validates completely before changing existing records', () => {
  const documents = new DocumentService({ records: records() });
  documents.open('B.cs');
  assert.throws(() => documents.replace([{ uri: 'C.cs', text: 'c' }, { uri: 'C.cs', text: 'duplicate' }]));
  assert.equal(documents.get('B.cs').text, 'beta');
  assert.equal(documents.active, 'B.cs');
  documents.update('B.cs', 'unsaved');
  assert.throws(() => documents.replace(records()), { code: 'DOCUMENT_DIRTY' });
  documents.dispose();
});

test('every legacy initial state key resolves through an explicit slice property descriptor', async () => {
  const initial = {
    langVersion: '14', debugSettings: {}, functionBreakpoints: [], debugSources: new Map(), immediateHistory: [],
    launchEpoch: 0, launchBusy: false, extraFiles: [], folders: [], membershipDirty: false, keymap: 'visual-studio',
    itemSelection: [], nativeMode: false, nativeWorkspace: null, nativeJob: null, projectSystem: null, projectSnapshot: null,
    startupProject: null, disk: null, diskRevision: 0, configuration: 'Debug', projectDiagnostics: [], toolReferences: [],
    extensionConfig: null, files: [], name: 'ParticleLab', active: 'Program.cs', tabs: [], revision: 1, result: null,
    image: null, assembly: null, ilDump: null, disassemblyFormat: 'cil', importedAssembly: false, buildDirty: false,
    dirtyFiles: new Set(), logs: [], programOutput: '', panel: 'output', debug: null, breakpoints: {}, watches: [],
    watchResults: new Map(), frameId: null, readOnly: false, analyzeTimer: null, saveTimer: null, compileBusy: false,
    selectedMethod: null, outputKind: 'all', modalClose: null
  };
  const store = createWorkspaceState(initial);
  for (const [key, value] of Object.entries(initial)) {
    assert.equal(store.state[key], value, key);
    assert.equal(typeof Object.getOwnPropertyDescriptor(store.state, key).get, 'function', key);
    assert.equal(Object.values(workspaceStateFields).some(fields => fields.includes(key)), true, key);
  }
  const events = [];
  store.subscribe(event => events.push(event));
  store.state.panel = 'watch';
  assert.equal(store.slices.ui.panel, 'watch');
  assert.equal(events[0].slice, 'ui');
  store.dispose();
  const source = await readFile(new URL('../apps/studio/studio.js', import.meta.url), 'utf8');
  assert.ok((source.match(/\bstate\.debug\s*=(?!=)/g) ?? []).length <= 3, 'New global debug writes bypass the session owner');
});

test('running project locks its shared source views while other project remains editable', async () => {
  const documents = new DocumentService({ records: records() });
  documents.setProjectMembership('A', ['A.cs']);
  documents.setProjectMembership('B', ['B.cs']);
  const a = { element: {}, setReadOnly(value) { this.readOnly = value; } };
  const b = { element: {}, setReadOnly(value) { this.readOnly = value; } };
  documents.attachEditor('A.cs', a);
  documents.attachEditor('B.cs', b);
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const locks = new DocumentLocks(documents, sessions);
  const session = sessions.create({ projectId: 'A' });
  await session.launch({ assembly: new Uint8Array([1]) });
  assert.equal(a.readOnly, true);
  assert.equal(b.readOnly, false);
  await session.stop();
  assert.equal(a.readOnly, false);
  locks.dispose();
  sessions.dispose();
  documents.dispose();
});
