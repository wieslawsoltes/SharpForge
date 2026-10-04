import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { AUTOMATIC_DOCUMENT_CHARACTERS } from '../apps/studio/workbench/document-size.js';

const uri = 'Program.cs';

function fixture(t, text = 'head\nbody\nend\n', { legacy = false } = {}) {
  const documents = new DocumentService({
    records: [{ uri, text, version: 1, encoding: 'utf-8', bom: false, byteLength: new TextEncoder().encode(text).length }],
    createModel: legacy ? undefined : record => new EditorModel(record.text, { uri: record.uri, version: record.version })
  });
  t.after(() => documents.dispose());
  documents.open(uri);
  return { documents, record: documents.require(uri), model: documents.models.get(uri) };
}

function reload(documents, text, options = {}) {
  const record = documents.require(uri);
  return documents.reload(uri, text, { expectedRecord: record, expectedVersion: record.version, ...options });
}

test('reload commits the shared model, saved baseline and encoding before document, buffer or view notifications', t => {
  const { documents, record, model } = fixture(t);
  model.applyEdits([{ start: 5, end: 9, text: 'local' }]);
  const before = model.snapshot();
  const undoDepth = model.undoStack.depth;
  const observed = [];
  let accepted;
  const observe = type => observed.push({ type, accepted: !!accepted, source: model.snapshot(),
    baseline: documents.baselines.get(uri), dirty: record.dirty, modelDirty: model.isDirty,
    encoding: record.encoding, bom: record.bom, modelEncoding: model.metadata.encoding, modelBom: model.metadata.bom });
  const offDocuments = documents.subscribe(event => observe(event.type));
  const offBuffer = model.buffer.onDidChange(() => observe('buffer'));
  const offView = model.onDidChange(() => observe('view'));
  t.after(offDocuments);
  t.after(offBuffer);
  t.after(offView);
  const text = 'head\r\nexternal\r\nend\r\n';

  const result = reload(documents, text, { encoding: 'utf-16le', bom: true, byteLength: text.length * 2 + 2,
    commitMetadata(capture) {
      assert.equal(documents.require(uri), record);
      assert.equal(documents.baselines.get(uri), capture.source);
      assert.equal(record.dirty, false);
      accepted = capture;
    }
  });

  assert.equal(result, accepted);
  assert.equal(result.committed, true);
  assert.equal(documents.models.get(uri), model);
  assert.equal(documents.require(uri), record);
  assert.equal(result.source, model.snapshot());
  assert.equal(result.version, before.version + 1);
  assert.equal(record.originalSource, result.source);
  assert.equal(Object.getOwnPropertyDescriptor(record, 'originalSource').enumerable, false);
  assert.equal(record.byteLength, text.length * 2 + 2);
  assert.equal(model.undoStack.depth, undoDepth + 1);
  assert.equal(model.preferredEol, '\r\n');
  assert.deepEqual(observed.map(item => item.type), ['changed', 'buffer', 'view', 'saved', 'dirty']);
  for (const item of observed) {
    assert.equal(item.accepted, true);
    assert.equal(item.source, result.source);
    assert.equal(item.baseline, result.source);
    assert.equal(item.dirty, false);
    assert.equal(item.modelDirty, false);
    assert.equal(item.encoding, 'utf-16le');
    assert.equal(item.modelEncoding, 'utf-16le');
    assert.equal(item.bom, true);
    assert.equal(item.modelBom, true);
  }
  assert.equal(before.statistics.textMaterialized, false);
});

test('reload is one undo step, retains an unaffected caret and restores clean state on redo', t => {
  const { documents, model } = fixture(t);
  model.setSelections([{ anchor: 2, active: 2 }]);
  const selections = model.selections;
  const result = reload(documents, 'head\nBODY\nend\n');
  assert.deepEqual(model.selections, selections);
  assert.equal(model.undoStack.depth, 1);
  assert.equal(model.isDirty, false);
  assert.equal(model.undo(), true);
  assert.equal(model.getText(), 'head\nbody\nend\n');
  assert.equal(documents.require(uri).dirty, true);
  assert.equal(documents.baselines.get(uri), result.source);
  assert.equal(model.redo(), true);
  assert.equal(model.getText(), 'head\nBODY\nend\n');
  assert.equal(documents.require(uri).dirty, false);
});

test('a metadata rejection restores source, undo, selections, baseline, metadata and stale-save state without notification', t => {
  const { documents, record, model } = fixture(t);
  const originalSave = documents.captureSave(uri);
  model.applyEdits([{ start: 5, end: 9, text: 'unsaved' }]);
  documents.markSaved(uri, originalSave);
  model.setSelections([{ anchor: 6, active: 9 }]);
  const selections = model.selections;
  const before = model.snapshot();
  const baseline = documents.baselines.get(uri);
  const revision = documents.revision;
  const undo = model.undoStack.statistics;
  const events = [];
  const off = documents.subscribe(event => events.push(event.type));
  const offModel = model.onDidChange(() => events.push('view'));
  t.after(off);
  t.after(offModel);

  assert.throws(() => reload(documents, 'external\r\n', { encoding: 'utf-16be', bom: true,
    commitMetadata() { throw new Error('The observed disk target changed'); }
  }), /observed disk target changed/);

  assert.equal(documents.require(uri), record);
  assert.equal(model.snapshot(), before);
  assert.equal(documents.baselines.get(uri), baseline);
  assert.equal(documents.revision, revision);
  assert.equal(record.dirty, true);
  assert.equal(documents.dirtyFiles.has(uri), true);
  assert.equal(documents.staleSaves.has(uri), true);
  assert.equal(record.encoding, 'utf-8');
  assert.equal(record.bom, false);
  assert.equal(model.metadata.encoding, 'utf-8');
  assert.equal(model.metadata.bom, false);
  assert.equal(record.originalSource, undefined);
  assert.deepEqual(model.selections, selections);
  assert.deepEqual(model.undoStack.statistics, undo);
  assert.deepEqual(events, []);
});

for (const layer of ['document', 'model']) {
  test(`${layer} notification failure reports a committed reload and still publishes saved state`, t => {
    const { documents, record, model } = fixture(t);
    const events = [];
    let diskSource;
    const fail = () => { throw new Error('View refresh failed'); };
    const offFailure = layer === 'document' ? documents.subscribe(event => { if (event.type === 'changed') fail(); })
      : model.onDidChange(fail);
    const offEvents = documents.subscribe(event => events.push(event.type));
    t.after(offFailure);
    t.after(offEvents);

    assert.throws(() => reload(documents, 'disk source\n', { commitMetadata: capture => { diskSource = capture.source; } }),
      error => error.code === 'DOCUMENT_COMMITTED' && error.committed === true && error instanceof AggregateError);

    assert.equal(model.getText(), 'disk source\n');
    assert.equal(record.dirty, false);
    assert.equal(model.isDirty, false);
    assert.equal(documents.baselines.get(uri), diskSource);
    assert.equal(model.snapshot(), diskSource);
    assert.deepEqual(events, ['changed', 'saved', 'dirty']);
    offFailure();
    model.applyEdits([{ start: 0, end: 0, text: 'later ' }]);
    assert.equal(record.dirty, true);
  });
}

test('an explicitly committed metadata error retains the accepted disk and document roots', t => {
  const { documents, model } = fixture(t);
  let diskSource;
  const events = [];
  const off = documents.subscribe(event => events.push(event.type));
  t.after(off);
  assert.throws(() => reload(documents, 'accepted\n', { commitMetadata(capture) {
    diskSource = capture.source;
    throw Object.assign(new Error('Disk metadata committed but refresh failed'), { committed: true });
  } }), error => error.code === 'DOCUMENT_COMMITTED' && error.committed === true);
  assert.equal(model.snapshot(), diskSource);
  assert.equal(documents.baselines.get(uri), diskSource);
  assert.equal(documents.require(uri).dirty, false);
  assert.deepEqual(events, ['changed', 'saved', 'dirty']);
});

for (const layer of ['document', 'model']) {
  test(`a newer edit from a ${layer} notification remains dirty and cannot receive a stale saved marker`, t => {
    const { documents, record, model } = fixture(t);
    let edited = false;
    const versions = [];
    const events = [];
    const edit = () => {
      if (edited) return;
      edited = true;
      model.applyEdits([{ start: 0, end: 0, text: 'newer ' }]);
    };
    const offEdit = layer === 'document' ? documents.subscribe(event => { if (event.type === 'changed') edit(); })
      : model.onDidChange(edit);
    const offEvents = documents.subscribe(event => events.push(event.type));
    const offModel = model.onDidChange(event => versions.push(event.version));
    t.after(offEdit);
    t.after(offEvents);
    t.after(offModel);
    const result = reload(documents, 'external\n');

    assert.equal(model.getText(), 'newer external\n');
    assert.equal(record.version, result.version + 1);
    assert.equal(record.dirty, true);
    assert.equal(documents.baselines.get(uri), result.source);
    assert.equal(events.includes('saved'), false);
    if (layer === 'document') assert.deepEqual(versions, [record.version]);
  });
}

test('reload guards reject stale ownership, versions, read-only state and invalid encoding before metadata acceptance', t => {
  const { documents, record, model } = fixture(t);
  const before = model.snapshot();
  const baseline = documents.baselines.get(uri);
  let accepted = 0;
  const commitMetadata = () => accepted++;
  for (const options of [{ expectedRecord: {} }, { expectedVersion: 0 }, { expectedVersion: undefined }]) {
    assert.throws(() => reload(documents, 'external', { commitMetadata, ...options }), error => error.code === 'DOCUMENT_STALE');
  }
  model.readOnly = true;
  assert.throws(() => reload(documents, 'external', { commitMetadata }), error => error.code === 'DOCUMENT_READ_ONLY');
  model.readOnly = false;
  record.readOnly = true;
  assert.throws(() => reload(documents, 'external', { commitMetadata }), error => error.code === 'DOCUMENT_READ_ONLY');
  record.readOnly = false;
  for (const options of [{ byteLength: 999 }, { bom: 'yes' }, { encoding: 'invalid-encoding' }, { commitMetadata: 7 }]) {
    assert.throws(() => reload(documents, 'external', { commitMetadata, ...options }));
  }
  assert.throws(() => documents.reload(uri, before, { expectedRecord: record, expectedVersion: record.version }), /bounded source text/);
  assert.equal(accepted, 0);
  assert.equal(model.snapshot(), before);
  assert.equal(documents.baselines.get(uri), baseline);
  assert.equal(record.dirty, false);
});

test('asynchronous metadata contributions are rejected and rolled back before any event', t => {
  const { documents, model } = fixture(t);
  const before = model.snapshot();
  const events = [];
  const off = documents.subscribe(event => events.push(event.type));
  t.after(off);
  assert.throws(() => reload(documents, 'external', { commitMetadata: () => Promise.resolve() }), /must be synchronous/);
  assert.equal(model.snapshot(), before);
  assert.equal(documents.baselines.get(uri), before);
  assert.deepEqual(events, []);
});

test('same-text reload accepts changed encoding and clears an obsolete saved baseline without adding an undo edit', t => {
  const { documents, record, model } = fixture(t);
  model.applyEdits([{ start: 5, end: 9, text: 'new' }]);
  const source = model.snapshot();
  const depth = model.undoStack.depth;
  const events = [];
  const off = documents.subscribe(event => events.push(event.type));
  t.after(off);
  const result = reload(documents, 'head\nnew\nend\n', { bom: true });
  assert.equal(result.source, source);
  assert.equal(result.version, source.version);
  assert.equal(model.undoStack.depth, depth);
  assert.equal(model.isDirty, false);
  assert.equal(record.dirty, false);
  assert.equal(record.bom, true);
  assert.equal(model.metadata.bom, true);
  assert.equal(documents.baselines.get(uri), source);
  assert.deepEqual(events, ['saved', 'dirty']);
});

test('legacy reload updates all views after metadata and classifies a failed view refresh as committed', t => {
  const { documents, record } = fixture(t, 'old', { legacy: true });
  let accepted = false;
  const refreshed = [];
  documents.attachEditor(uri, { element: {}, setValue() { throw new Error('First view failed'); } });
  documents.attachEditor(uri, { element: {}, setValue(value) { refreshed.push({ value, accepted }); } }, { viewId: 'split' });
  assert.throws(() => reload(documents, 'new', { commitMetadata() { accepted = true; } }),
    error => error.code === 'DOCUMENT_COMMITTED' && error.committed === true);
  assert.equal(record.text, 'new');
  assert.equal(record.version, 2);
  assert.equal(record.dirty, false);
  assert.equal(documents.baselines.get(uri), 'new');
  assert.deepEqual(refreshed, [{ value: 'new', accepted: true }]);
});

test('reload permits the exact shared character limit and rejects larger incoming or existing sources', t => {
  const text = 'x'.repeat(AUTOMATIC_DOCUMENT_CHARACTERS);
  const { documents, record } = fixture(t, text, { legacy: true });
  const result = reload(documents, text);
  assert.equal(result.byteLength, AUTOMATIC_DOCUMENT_CHARACTERS);
  assert.equal(record.version, 1);
  assert.throws(() => reload(documents, text + 'x'), error => error.code === 'DOCUMENT_RELOAD_LIMIT');
  const oversized = fixture(t, text + 'x', { legacy: true });
  assert.throws(() => reload(oversized.documents, ''), error => error.code === 'DOCUMENT_RELOAD_LIMIT');
  assert.equal(oversized.record.text.length, AUTOMATIC_DOCUMENT_CHARACTERS + 1);
});

test('a disposed owner cannot reload or accept disk metadata', t => {
  const { documents, record } = fixture(t);
  documents.dispose();
  let accepted = false;
  assert.throws(() => documents.reload(uri, 'external', {
    expectedRecord: record, expectedVersion: 1, commitMetadata: () => { accepted = true; }
  }), error => error.code === 'DOCUMENTS_DISPOSED');
  assert.equal(accepted, false);
});
