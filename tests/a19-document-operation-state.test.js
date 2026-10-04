import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { DocumentService } from '../apps/studio/workbench/documents.js';

const createModel = record => new EditorModel(record.text, { uri: record.uri, version: record.version });
const open = () => new DocumentService({ records: [{ uri: 'A.cs', text: 'original', version: 1 }], createModel });
const prepared = (model, path = model.uri) => ({ path, model, source: model.snapshot(), version: model.version });

test('document operation state captures immutable current and saved roots without live model ownership', () => {
  const documents = open();
  const model = documents.models.get('A.cs');
  const clean = documents.captureState('A.cs');
  assert.equal(clean.source, model.snapshot());
  assert.equal(clean.baseline, clean.source);
  assert.equal(clean.dirty, false);
  model.applyEdits([{ start: 0, end: 0, text: 'unsaved' }]);
  const dirty = documents.captureState('A.cs');
  assert.equal(Object.isFrozen(dirty), true);
  assert.equal(dirty.source, model.snapshot());
  assert.equal(dirty.baseline, clean.source);
  assert.equal(dirty.version, model.version);
  assert.equal(dirty.dirty, true);
  assert.equal('model' in dirty, false);
  assert.equal(dirty.source.statistics.textMaterialized, false);
  assert.equal(clean.source.statistics.textMaterialized, false);
  documents.dispose();
});

test('validated moved-model state retains a rebased dirty baseline through subsequent edits and undo', () => {
  const documents = open();
  const original = documents.models.get('A.cs');
  original.applyEdits([{ start: 0, end: 0, text: 'unsaved' }]);
  const state = documents.captureState('A.cs');
  const model = new EditorModel(state.source.withMetadata({ uri: 'B.cs' }), { uri: 'B.cs', version: state.version });
  const baseline = state.baseline.withMetadata({ uri: 'B.cs' });
  const restored = { ...state, uri: 'B.cs', source: model.snapshot(), baseline };
  documents.replace([prepared(model)], { discard: true, documentStates: new Map([['B.cs', restored]]) });
  assert.equal(documents.get('B.cs').dirty, true);
  assert.equal(documents.baselines.get('B.cs'), baseline);
  assert.equal(documents.staleSaves.has('B.cs'), true);
  model.applyEdits([{ start: 0, end: 0, text: 'temporary' }]);
  model.undo();
  assert.equal(documents.get('B.cs').dirty, true);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  assert.equal(baseline.statistics.textMaterialized, false);
  assert.throws(() => original.prepareEdits([]), /disposed/);
  documents.dispose();
});

test('operation state mismatches reject before ownership transfers or saved markers change', () => {
  const documents = open();
  const original = documents.models.get('A.cs');
  const model = new EditorModel('incoming', { uri: 'B.cs', version: 5 });
  const good = { uri: 'B.cs', version: 5, source: model.snapshot(), baseline: model.snapshot(), dirty: false, staleSave: false };
  const invalid = [undefined, { ...good, uri: 'Wrong.cs' }, { ...good, version: 4 },
    { ...good, source: original.snapshot() }, { ...good, baseline: original.snapshot(), dirty: true },
    { ...good, baseline: null }, { ...good, staleSave: true }, { ...good, dirty: 'false' }];
  for (const state of invalid) {
    assert.throws(() => documents.replace([prepared(model)], { documentStates: new Map([['B.cs', state]]) }));
    assert.equal(documents.models.get('A.cs'), original);
    assert.equal(documents.ownsModel(model), false);
    assert.doesNotThrow(() => model.prepareEdits([]));
    assert.equal(original.isDirty, false);
  }
  assert.throws(() => documents.replace([prepared(model)], { documentStates: {} }), /Map/);
  assert.throws(() => documents.replace([prepared(model)], { documentStates: new Map([['Missing.cs', good]]) }), /missing document/);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  model.dispose();
  documents.dispose();
});

test('new plain-text operation state transfers to a factory model while an explicit clean restore updates its saved marker', () => {
  const documents = new DocumentService({ createModel });
  const state = { uri: 'New.cs', version: 1, source: 'created', baseline: null, dirty: true, staleSave: false };
  documents.replace([{ uri: 'New.cs', text: 'created', version: 1 }], { documentStates: new Map([['New.cs', state]]) });
  const model = documents.models.get('New.cs');
  assert.equal(documents.get('New.cs').dirty, true);
  assert.equal(documents.baselines.get('New.cs'), null);
  model.applyEdits([{ start: 0, end: 0, text: 'changed' }]);
  const source = model.snapshot();
  const clean = { uri: 'New.cs', version: source.version, source, baseline: source, dirty: false, staleSave: false };
  documents.replace(documents.files, { preserveDirty: true, documentStates: new Map([['New.cs', clean]]) });
  assert.equal(documents.models.get('New.cs'), model);
  assert.equal(documents.get('New.cs').dirty, false);
  assert.equal(model.isDirty, false);
  assert.equal(source.statistics.textMaterialized, false);
  documents.dispose();
});
