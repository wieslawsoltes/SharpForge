import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '../packages/editor/src/model.js';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { DocumentLocks } from '../apps/studio/workbench/document-locks.js';
import { SessionManager } from '../apps/studio/workbench/session-manager.js';
import { createWorkbenchServices } from '../apps/studio/workbench/sessions.js';
import { WorkbenchEvents } from '../apps/studio/workbench/state-events.js';
import { fakeWorkers, fakeRuntime, compileResult, deferred } from './a19-session-fixtures.js';

const createModel = record => new EditorModel(record.text, { uri: record.uri, version: record.version });
const records = () => [{ uri: 'A.cs', text: 'alpha', version: 3 }, { uri: 'B.cs', text: 'beta', version: 1 }];

test('document model edits and event delivery retain lazy snapshots for a one-megabyte source', () => {
  const documents = new DocumentService({ records: [{ uri: 'A.cs', text: 'x'.repeat(1_000_000), version: 5 }], createModel });
  const model = documents.models.get('A.cs');
  const record = documents.get('A.cs');
  const changes = [];
  documents.subscribe(event => {
    if (event.type !== 'changed') return;
    assert.equal(event.change.after.statistics.textMaterialized, false);
    changes.push(event);
  });
  for (let index = 0; index < 100; index++) {
    model.applyEdits([{ start: model.length, end: model.length, text: 'a' }], { undoStop: true });
    assert.equal(model.snapshot().statistics.textMaterialized, false);
  }
  assert.equal(changes.length, 100);
  assert.equal(record.version, 105);
  assert.equal(record.dirty, true);
  assert.equal(documents.dirtyFiles.has('A.cs'), true);
  assert.equal(typeof Object.getOwnPropertyDescriptor(changes[0], 'previous').get, 'function');
  assert.equal(changes[0].previous.length, 1_000_000);
  assert.equal(changes[0].text.length, 1_000_001);
  assert.equal(model.snapshot().statistics.textMaterialized, false, 'Reading an old event must not materialize the current document');
  assert.equal(record.text.length, 1_000_100);
  assert.equal(model.snapshot().statistics.textMaterialized, true);
  for (let index = 0; index < 100; index++) model.undo();
  assert.equal(record.dirty, false);
  assert.equal(documents.dirtyFiles.has('A.cs'), false);
  assert.equal(record.version, model.version);
  documents.dispose();
});

test('split views share the real model and undo without text-copy callbacks or shared view positions', () => {
  const contexts = [];
  const documents = new DocumentService({ records: records(), createModel, createEditor: (record, context) => {
    contexts.push(context);
    return {
      element: {}, model: null, position: { start: 0, end: 0, scrollTop: 0 },
      setModel(uri, model) { this.model = model; },
      setValue() { throw new Error('Shared model views must not receive full-text synchronization'); },
      getViewState() { return { ...this.position }; },
      restoreViewState(state) { this.position = { ...state }; },
      dispose() { this.disposed = true; }
    };
  } });
  documents.createDocument('A.cs');
  documents.createDocument('A.cs', { viewId: 'split' });
  const first = documents.views.get('A.cs').get('primary').editor;
  const second = documents.views.get('A.cs').get('split').editor;
  assert.equal(contexts[0].model, contexts[1].model);
  assert.equal(contexts[0].onChange, undefined);
  assert.equal(first.model, second.model);
  first.model.applyEdits([{ start: 0, end: 5, text: 'shared' }]);
  assert.equal(second.model.text, 'shared');
  second.model.undo();
  assert.equal(first.model.text, 'alpha');
  documents.restoreViewState('A.cs', { start: 2, end: 4, scrollTop: 80 }, 'split');
  assert.equal(documents.getViewState('A.cs').start, 0);
  assert.equal(documents.getViewState('A.cs', 'split').start, 2);
  documents.close('A.cs');
  assert.equal(first.disposed && second.disposed, true);
  assert.equal(documents.models.get('A.cs').text, 'alpha', 'Closing views retains the workspace document model');
  documents.dispose();
});

test('legacy document text setters apply undoable edits while the version remains model-owned', () => {
  const documents = new DocumentService({ records: records(), createModel });
  const record = documents.get('A.cs');
  record.text = 'changed';
  assert.equal(record.version, 4);
  assert.equal(documents.models.get('A.cs').canUndo, true);
  assert.throws(() => { record.version++; }, TypeError);
  assert.throws(() => documents.update('A.cs', 'stale', { version: 3 }), { code: 'DOCUMENT_STALE' });
  documents.models.get('A.cs').undo();
  assert.equal(record.text, 'alpha');
  assert.equal(record.dirty, false);
  documents.dispose();
});

test('save preparation runs before capture and a later edit never inherits that saved marker', async () => {
  const written = [];
  const pending = deferred();
  const documents = new DocumentService({ records: records(), createModel, saveDocument: snapshot => {
    written.push(snapshot);
    return pending.promise;
  } });
  const model = documents.models.get('A.cs');
  documents.attachEditor('A.cs', {
    element: {}, model,
    prepareSave() { model.setValue('prepared\n', { undoStop: true }); }
  });
  const saving = documents.save('A.cs');
  assert.equal(written[0].text, 'prepared\n');
  assert.equal(written[0].version, model.version);
  model.setValue('typed during save');
  pending.resolve(true);
  assert.equal(await saving, false);
  assert.equal(documents.get('A.cs').dirty, true);
  assert.equal(model.isDirty, true);
  documents.close('A.cs', { discard: true });
  assert.equal(model.text, 'prepared\n');
  assert.equal(model.isDirty, false);
  assert.equal(documents.dirtyFiles.has('A.cs'), false);
  documents.dispose();
});

test('model factories validate replacement before disposing the current workspace and retain the shared map identity', () => {
  const created = [];
  const documents = new DocumentService({ records: records(), createModel: record => {
    if (record.uri === 'invalid') throw new Error('invalid model');
    const model = createModel(record);
    created.push(model);
    return model;
  } });
  const map = documents.models;
  const original = map.get('A.cs');
  assert.throws(() => documents.replace([{ uri: 'new', text: 'new' }, { uri: 'invalid', text: '' }]), /invalid model/);
  assert.equal(documents.models.get('A.cs'), original);
  assert.throws(() => created.at(-1).applyEdits([{ start: 0, end: 0, text: 'after disposal' }]), /disposed/);
  original.applyEdits([{ start: 0, end: 0, text: 'kept' }]);
  const changed = documents.snapshot().files;
  documents.replace(changed, { discard: true, preserveEditors: true });
  assert.equal(documents.models, map);
  assert.equal(map.get('A.cs'), original);
  assert.equal(original.isDirty, false);
  documents.replace(records(), { discard: true });
  assert.equal(documents.models, map);
  assert.notEqual(map.get('A.cs'), original);
  assert.throws(() => original.applyEdits([{ start: 0, end: 0, text: 'after disposal' }]), /disposed/);
  documents.dispose();
});

test('project locks cover unopened models and update linked-source membership without locking unrelated projects', async () => {
  const documents = new DocumentService({ records: records(), createModel });
  documents.setProjectMembership('A', ['A.cs']);
  documents.setProjectMembership('B', ['B.cs']);
  const fake = fakeWorkers(fakeRuntime);
  const sessions = new SessionManager({ workerFactory: fake.factory });
  const locks = new DocumentLocks(documents, sessions);
  const session = sessions.create({ projectId: 'A' });
  await session.launch({ assembly: new Uint8Array([1]) });
  assert.equal(documents.models.get('A.cs').readOnly, true);
  assert.equal(documents.models.get('B.cs').readOnly, false);
  documents.setProjectMembership('A', ['A.cs', 'B.cs']);
  assert.equal(documents.models.get('B.cs').readOnly, true);
  documents.setProjectMembership('A', ['A.cs']);
  assert.equal(documents.models.get('B.cs').readOnly, false);
  await session.stop();
  assert.equal(documents.models.get('A.cs').readOnly, false);
  locks.dispose();
  sessions.dispose();
  documents.dispose();
});

test('model events invalidate only owning builds without materializing text until compilation requests a snapshot', async () => {
  const source = records();
  const fake = fakeWorkers(message => message.method === 'build' ? compileResult() : {});
  const services = createWorkbenchServices({ createModel, workerFactory: fake.factory, records: source,
    projects: source.map(record => ({ id: record.uri[0], files: [record] })) });
  const model = services.documents.models.get('A.cs');
  model.applyEdits([{ start: 0, end: 0, text: 'new ' }]);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  assert.equal(services.builds.get('A').revision, 1);
  assert.equal(services.builds.get('B').revision, 0);
  await services.builds.get('A').build();
  assert.equal(fake.workers[0].requests[0].params.files[0].text, 'new alpha');
  assert.equal(fake.workers[0].requests[0].params.files[0].version, model.version);
  services.dispose();
});

test('ordered workbench events preserve lazy getters even during reentrant dispatch', () => {
  const events = new WorkbenchEvents();
  let reads = 0;
  const seen = [];
  events.subscribe(event => {
    seen.push(event);
    if (event.type === 'first') events.emit({ type: 'second', get text() { reads++; return 'second'; } });
  });
  events.emit({ type: 'first', get text() { reads++; return 'first'; } });
  assert.equal(reads, 0);
  assert.deepEqual(seen.map(event => event.type), ['first', 'second']);
  assert.equal(seen[1].text, 'second');
  assert.equal(reads, 1);
  events.dispose();
});
