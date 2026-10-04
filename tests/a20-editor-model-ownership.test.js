import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeEditor, EditorModel, FoldingStateStore } from '@sharpforge/editor';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { DocumentLocks } from '../apps/studio/workbench/document-locks.js';

// Headless presentation boundaries around the real CodeEditor save/dispose methods and document owner.
function viewFor(models, model, failure) {
  const editor = Object.create(CodeEditor.prototype);
  const noop = { dispose() {} };
  Object.assign(editor, {
    uri: model.uri, model, models,
    session: { models, views: new Set(), foldingState: new FoldingStateStore() },
    selections: [{ anchor: 1, active: 3 }], primaryIndex: 0, viewStates: new Map(),
    bookmarks: { retained: 'bookmarks' }, changeTracking: { retained: 'changes' },
    folding: { regions: [{ startLine: 0, endLine: 2, collapsed: true }], dispose() {} },
    view: { scrollTop: 80, viewport: { scrollLeft: 12 }, dispose() {} },
    input: { selectionStart: 1, selectionEnd: 3, scrollTop: 80, scrollLeft: 12 },
    element: { replaceChildren() {} }, contributions: new Set(),
    presentation: { setReadOnly(value) { editor.model.readOnly = value; } },
    splitController: noop, keymapAdapter: noop, foldingProvider: noop, largeFile: noop,
    bracketColors: noop, inputController: noop, accessibility: noop, zoomControl: noop,
    goToWidget: noop, highlightIndex: noop
  });
  if (failure) editor.contributions.add({ dispose() { throw failure; } });
  editor.session.views.add(editor);
  return editor;
}

function fixture() {
  const created = new Set();
  const documents = new DocumentService({
    records: [{ uri: 'Old.cs', text: 'old\nsource\ntext', version: 1 }],
    createModel: record => {
      const model = new EditorModel(record.text, { uri: record.uri, version: record.version });
      created.add(model);
      return model;
    }
  });
  const sessions = { list: () => [], subscribe: () => () => {} };
  const locks = new DocumentLocks(documents, sessions);
  return { documents, locks, dispose() {
    try { locks.dispose(); documents.dispose(); }
    finally { for (const model of created) model.dispose(); }
  } };
}

function assertViewSaved(editor) {
  const saved = editor.viewStates.get('Old.cs');
  assert.deepEqual(saved.selections, [{ anchor: 1, active: 3 }]);
  assert.equal(saved.primaryIndex, 0);
  assert.equal(saved.top, 80);
  assert.equal(saved.left, 12);
  assert.equal(saved.bookmarks, editor.bookmarks);
  assert.equal(saved.changeTracking, editor.changeTracking);
  assert.deepEqual(saved.folds, [{ startLine: 0, endLine: 2, collapsed: true }]);
  assert.deepEqual(editor.session.foldingState.documents.get('Old.cs'), [{ startLine: 0, endLine: 2 }]);
}

for (const action of ['removed', 'replaced']) {
  test(`saving a retired view does not resurrect a model ${action} by its external session owner`, () => {
    const oldModel = new EditorModel('old\nsource\ntext', { uri: 'Old.cs' });
    const nextModel = new EditorModel('new', { uri: 'Old.cs' });
    const models = new Map([['Old.cs', oldModel]]);
    const editor = viewFor(models, oldModel);
    try {
      // Session model maps are caller-owned; ownership changes before a queued view is retired.
      if (action === 'removed') models.delete('Old.cs');
      else models.set('Old.cs', nextModel);
      editor.dispose();
      assert.equal(models.has('Old.cs'), action === 'replaced');
      assert.equal(models.get('Old.cs'), action === 'replaced' ? nextModel : undefined);
      assert.equal(editor.disposed, true);
      assertViewSaved(editor);
    } finally { oldModel.dispose(); nextModel.dispose(); }
  });
}

test('main document replacement preserves the shared map and locks after its precommit view retirement', () => {
  const fixtureValue = fixture();
  const { documents, locks } = fixtureValue;
  try {
    const map = documents.models;
    const oldModel = map.get('Old.cs');
    const editor = viewFor(map, oldModel);
    documents.attachEditor('Old.cs', editor);
    assert.equal(documents.replace([{ uri: 'New.cs', text: 'new', version: 2 }],
      { discard: true, preserveEditors: true }), undefined);
    assert.equal(documents.models, map);
    assert.deepEqual([...map.keys()], ['New.cs']);
    assert.equal(map.get('New.cs').text, documents.get('New.cs').text);
    assert.throws(() => { oldModel.readOnly = true; }, /disposed/);
    assert.doesNotThrow(() => locks.apply());
    assertViewSaved(editor);
  } finally { fixtureValue.dispose(); }
});

test('closing a main view preserves its still-owned model and saved view state', () => {
  const fixtureValue = fixture();
  const { documents, locks } = fixtureValue;
  try {
    const model = documents.models.get('Old.cs');
    const editor = viewFor(documents.models, model);
    documents.attachEditor('Old.cs', editor);
    documents.close('Old.cs');
    assert.equal(documents.models.get('Old.cs'), model);
    assert.equal(model.text, documents.get('Old.cs').text);
    assert.doesNotThrow(() => { model.readOnly = true; locks.apply(); });
    assert.equal(editor.disposed, true);
    assertViewSaved(editor);
  } finally { fixtureValue.dispose(); }
});

test('main replacement preserves its exact precommit cleanup failure and original document ownership', () => {
  const fixtureValue = fixture();
  const { documents, locks } = fixtureValue;
  const failure = new Error('view contribution cleanup failed');
  const model = documents.models.get('Old.cs');
  const editor = viewFor(documents.models, model, failure);
  documents.attachEditor('Old.cs', editor);
  try {
    assert.throws(() => documents.replace([{ uri: 'New.cs', text: 'new', version: 2 }],
      { discard: true, preserveEditors: true }), error => error === failure);
    assert.equal(failure.committed, undefined);
    assert.deepEqual([...documents.models.keys()], ['Old.cs']);
    assert.equal(documents.models.get('Old.cs'), model);
    assert.equal(documents.get('Old.cs').text, model.text);
    assert.doesNotThrow(() => locks.apply());
    assertViewSaved(editor);
  } finally { fixtureValue.dispose(); }
});
