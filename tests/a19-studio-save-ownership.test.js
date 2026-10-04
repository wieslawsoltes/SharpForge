import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { DiskWorkspace } from '@sharpforge/project-system';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { StudioSave } from '../apps/studio/workbench/studio-save.js';
import { saveStudioSourceAs } from '../apps/studio/workbench/source-save-as.js';
import { readStudioSource } from '../apps/studio/workbench/studio-source-reader.js';
import { studioLoaderFixture } from './support/studio-loader-fixture.js';
import { sourceFileHandle } from './fixtures/a20-source-file-fixture.js';

const decode = handle => new TextDecoder().decode(handle.bytes);

function saveFixture(t, picker) {
  const fixture = studioLoaderFixture(t);
  const calls = { refresh: 0, recovery: 0, notices: [], signals: [] };
  const saves = new StudioSave({
    documents: fixture.services.documents,
    state: () => fixture.state,
    canRecover: () => false,
    saveRecovery: () => { calls.recovery++; return false; },
    saveAs: (snapshot, options) => {
      calls.signals.push(options.signal);
      return saveStudioSourceAs(snapshot, { ...options, window: { showSaveFilePicker: picker } });
    },
    notify: message => calls.notices.push(message),
    refresh: () => calls.refresh++
  });
  t.after(() => saves.dispose());
  return { ...fixture, saves, saveCalls: calls, documents: fixture.services.documents };
}

function attachOriginalDisk(state, documents, handle) {
  const snapshot = documents.captureSave('Old.cs');
  state.disk = new DiskWorkspace([{ path: snapshot.uri, source: snapshot.source, version: snapshot.version,
    byteLength: handle.bytes.byteLength }],
    new Map([['Old.cs', handle]]), 'Original folder', [], [], { readSource: readStudioSource });
  return state.disk;
}

test('Studio bulk save follows the successful Save As handle and leaves the original file untouched', async t => {
  const selected = sourceFileHandle('Chosen.cs', '');
  const { state, documents, saves } = saveFixture(t, () => selected);
  const original = sourceFileHandle('Old.cs', '// old source');
  const originalDisk = attachOriginalDisk(state, documents, original);
  const model = documents.models.get('Old.cs');
  model.applyEdits([{ start: 0, end: 0, text: '// first save\n' }]);
  const first = model.snapshot();

  const savedAs = await saves.as('Old.cs');
  assert.equal(savedAs.ok, true);
  assert.equal(savedAs.source, first);
  assert.equal(decode(selected), '// first save\n// old source');
  assert.equal(saves.target('Old.cs').handles.get('Old.cs'), selected);
  assert.equal(state.disk, originalDisk);
  assert.equal(originalDisk.handles.get('Old.cs'), original);

  model.applyEdits([{ start: 0, end: 0, text: '// next save\n' }]);
  const latest = model.snapshot();
  assert.deepEqual((await saves.disk()).written, ['Old.cs']);
  assert.equal(decode(selected), '// next save\n// first save\n// old source');
  assert.equal(selected.metrics.written, 2);
  assert.equal(decode(original), '// old source');
  assert.equal(original.metrics.opened, 0);
  assert.equal(original.reads.length, 0);
  assert.equal(documents.baselines.get('Old.cs'), latest);
  assert.equal(documents.require('Old.cs').dirty, false);
  assert.equal(first.statistics.textMaterialized, false);
});

test('bulk I/O cannot reconcile a replacement document with the same URI and version', async t => {
  const permissionEntered = Promise.withResolvers();
  const permission = Promise.withResolvers();
  const { state, documents, saves, saveCalls } = saveFixture(t, () => assert.fail('Unexpected Save As picker'));
  const handle = sourceFileHandle('Old.cs', '// old source', { permission: () => {
    permissionEntered.resolve();
    return permission.promise;
  } });
  attachOriginalDisk(state, documents, handle);
  documents.update('Old.cs', '// captured old document');
  const oldRecord = documents.require('Old.cs');
  const captured = documents.captureSave('Old.cs');
  const savedEvents = [];
  const unsubscribe = documents.subscribe(event => { if (event.type === 'saved') savedEvents.push(event.record); });
  t.after(unsubscribe);

  const pending = assert.rejects(saves.disk(), { name: 'AbortError' });
  await permissionEntered.promise;
  documents.replace([{ uri: 'Old.cs', text: '// replacement baseline', version: captured.version - 1 }], { discard: true });
  const replacementBaseline = documents.baselines.get('Old.cs');
  documents.update('Old.cs', '// replacement unsaved');
  const replacement = documents.require('Old.cs');
  assert.notEqual(replacement, oldRecord);
  assert.equal(replacement.version, captured.version);
  permission.resolve('granted');
  await pending;

  assert.equal(documents.require('Old.cs'), replacement);
  assert.equal(replacement.text, '// replacement unsaved');
  assert.equal(replacement.dirty, true);
  assert.equal(documents.models.get('Old.cs').isDirty, true);
  assert.equal(documents.baselines.get('Old.cs'), replacementBaseline);
  assert.equal(documents.dirtyFiles.has('Old.cs'), true);
  assert.deepEqual(savedEvents, []);
  assert.equal(saveCalls.refresh, 0);
  assert.equal(saveCalls.recovery, 0);
  assert.equal(handle.metrics.opened, 0);
  assert.equal(decode(handle), '// old source');
});

test('disposing StudioSave cancels an outstanding picker without retaining targets or refreshing documents', async t => {
  const picker = Promise.withResolvers();
  let pickerCalls = 0;
  const { documents, saves, saveCalls } = saveFixture(t, () => { pickerCalls++; return picker.promise; });
  documents.update('Old.cs', '// still unsaved');
  const baseline = documents.baselines.get('Old.cs');
  const selected = sourceFileHandle('Late.cs', 'previous contents');

  const pending = saves.as('Old.cs');
  assert.equal(pickerCalls, 1);
  assert.equal(saveCalls.signals[0].aborted, false);
  saves.dispose();
  assert.equal(saveCalls.signals[0].aborted, true);
  picker.resolve(selected);
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(selected.metrics.opened, 0);
  assert.equal(decode(selected), 'previous contents');
  assert.equal(saves.sourceTargets.size, 0);
  assert.equal(saves.operations.size, 0);
  assert.equal(saveCalls.refresh, 0);
  assert.equal(saveCalls.recovery, 0);
  assert.deepEqual(saveCalls.notices, []);
  assert.equal(documents.require('Old.cs').dirty, true);
  assert.equal(documents.baselines.get('Old.cs'), baseline);
});

test('native workspaces reject browser Save As before asking for a destination', async t => {
  let pickerCalls = 0;
  const { state, documents, saves, saveCalls } = saveFixture(t, () => { pickerCalls++; return null; });
  documents.update('Old.cs', '// native edit');
  state.nativeMode = true;
  await assert.rejects(saves.as('Old.cs'), /connected local host.*native workspace save destination/i);
  assert.equal(pickerCalls, 0);
  assert.equal(saveCalls.signals.length, 0);
  assert.equal(saves.sourceTargets.size, 0);
  assert.equal(saves.operations.size, 0);
  assert.equal(documents.require('Old.cs').dirty, true);
  assert.equal(saveCalls.refresh, 0);
});

test('document save acquires its picker synchronously and commits the exact asynchronously normalized capture', async t => {
  const normalizing = Promise.withResolvers();
  const normalization = Promise.withResolvers();
  const order = [];
  const selected = sourceFileHandle('Normalized.cs', '');
  let saves;
  let coordinated;
  let normalized;
  let preparationSignal;
  const services = createWorkbenchServices({
    records: [{ uri: 'Program.cs', text: 'class Program {}  ', version: 1 }],
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version }),
    createEditor: (record, { model }) => ({
      model, element: {},
      async prepareSave({ signal }) {
        order.push('normalize');
        preparationSignal = signal;
        normalizing.resolve();
        await normalization.promise;
        model.applyEdits([{ start: model.length - 2, end: model.length, text: '\n' }]);
        normalized = model.snapshot();
      },
      dispose() {}
    }),
    coordinateDocumentSave: transaction => saves.coordinate(transaction).then(result => {
      coordinated = result;
      return result;
    })
  });
  t.after(() => services.dispose());
  const documents = services.documents;
  documents.createDocument('Program.cs');
  documents.update('Program.cs', '// unsaved\nclass Program {}  ');
  saves = new StudioSave({ documents, state: () => ({ nativeMode: false, disk: null }),
    canRecover: () => false, saveRecovery: () => false, notify() {}, refresh() {},
    saveAs: (snapshot, options) => saveStudioSourceAs(snapshot, { ...options, window: {
      showSaveFilePicker() { order.push('picker'); return selected; }
    } })
  });
  t.after(() => saves.dispose());

  const pending = documents.save('Program.cs');
  assert.equal(order[0], 'picker');
  assert.equal(order.filter(step => step === 'picker').length, 1);
  await normalizing.promise;
  assert.deepEqual(order, ['picker', 'normalize']);
  assert.equal(preparationSignal.aborted, false);
  assert.equal(selected.metrics.opened, 0);
  normalization.resolve();
  assert.equal(await pending, true);
  assert.equal(coordinated.ok, true);
  assert.equal(coordinated.snapshot.source, normalized);
  assert.equal(coordinated.snapshot.version, normalized.version);
  assert.equal(coordinated.snapshot.uri, 'Program.cs');
  assert.equal(documents.baselines.get('Program.cs'), normalized);
  assert.equal(documents.require('Program.cs').dirty, false);
  assert.equal(decode(selected), '// unsaved\nclass Program {}\n');
  assert.equal(selected.metrics.written, 1);
  assert.equal(normalized.statistics.textMaterialized, false);
});
