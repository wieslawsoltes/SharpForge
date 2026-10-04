import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor, EditorModel, FoldingModel, FoldingStateStore, SyntaxHighlightIndex} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {DocumentLocks} from '../apps/studio/workbench/document-locks.js';

// Supply headless rendering adapters, but run the production view save, switch and disposal methods.
function editorView(model, session, detached = () => {}) {
  const passive = () => ({dispose() {}});
  const view = Object.create(CodeEditor.prototype);
  Object.assign(view, {
    model, uri: model.uri, session, models: session.models, viewStates: new Map(),
    selections: model.selections.map(selection => ({...selection})), primaryIndex: 0,
    options: {}, disposed: false, endOfLineExplicit: false, decorationOwners: new Map(),
    contributions: new Set(), folding: new FoldingModel(),
    highlightIndex: new SyntaxHighlightIndex(model.snapshot()),
    element: {replaceChildren() {}},
    input: {
      selectionStart: 0, selectionEnd: 0, scrollTop: 17, scrollLeft: 9,
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    },
    inputController: {...passive(), composition: {cancel() {}}},
    keymapAdapter: {...passive(), setModel() {}}, splitController: passive(),
    foldingProvider: {...passive(), refresh() {}}, largeFile: {...passive(), update() {}},
    bracketColors: {...passive(), update() {}}, accessibility: passive(), zoomControl: passive(), goToWidget: passive(),
    view: {
      ...passive(), scrollTop: 17, viewport: {scrollLeft: 9}, layout: {reset() {}},
      scroll: {reset() {}, update() {}},
      scrollTo({top, left}) { this.scrollTop = top; this.viewport.scrollLeft = left; }
    },
    presentation: {
      syncReadOnly() { view.input.readOnly = view.model.readOnly; },
      setReadOnly(value) { view.model.setReadOnly(value); this.syncReadOnly(); }
    },
    cursor() {}
  });
  const unsubscribe = model.onDidChange(() => {});
  view.modelSubscription = () => { detached(model, session.models.get(model.uri)); unsubscribe(); };
  view.readOnlySubscription = model.onDidChangeReadOnly(() => view.presentation.syncReadOnly());
  session.views.add(view);
  return view;
}

function fixture(t, records, {detached} = {}) {
  const documents = new DocumentService({records,
    createModel: record => new EditorModel(record.text, {uri: record.uri, version: record.version})});
  const session = {models: documents.models, views: new Set(), foldingState: new FoldingStateStore()};
  documents.createEditor = (record, {model}) => editorView(model, session, detached);
  const running = {id: 'run', projectId: 'App', readOnly: true,
    lastLaunch: {dependencies: [{project: 'Library'}]}};
  const locks = new DocumentLocks(documents, {list: () => [running], subscribe: () => () => {}});
  t.after(() => { locks.dispose(); documents.dispose(); });
  return {documents, session, locks, running};
}

test('replacing a workspace retires shared editor views without resurrecting disposed document models', t => {
  const {documents, session} = fixture(t, [{uri: 'Old.cs', text: 'old'}]);
  documents.createDocument('Old.cs');
  documents.createDocument('Old.cs', {viewId: 'split'});
  const original = documents.models.get('Old.cs');
  const views = [...session.views];
  const owners = documents.models;
  const result = documents.replace([{uri: 'Generated.cs', text: 'new', generated: true}],
    {discard: true, preserveEditors: true});

  assert.equal(result.committed, true);
  assert.equal(documents.models, owners, 'the Studio editor session retains the same owner map');
  assert.deepEqual([...owners.keys()], ['Generated.cs']);
  assert.equal(documents.get('Old.cs'), null);
  assert.equal(documents.views.has('Old.cs'), false);
  assert.equal(session.views.size, 0);
  assert(views.every(view => view.disposed));
  assert.equal(documents.models.get('Generated.cs').readOnly, true);
  assert.throws(() => original.setReadOnly(false), /EditorModel is disposed/);
});

test('all retained views switch to the new owner without publishing the old model during detachment', t => {
  const detachedOwners = [];
  const {documents, locks, running} = fixture(t, [{uri: 'Shared.cs', text: 'old'}],
    {detached: (previous, owner) => detachedOwners.push({previous, owner})});
  documents.setProjectMembership('Library', ['Shared.cs']);
  documents.createDocument('Shared.cs');
  documents.createDocument('Shared.cs', {viewId: 'split'});
  const previous = documents.models.get('Shared.cs');
  documents.replace([{uri: 'Shared.cs', text: 'replacement', version: 2}], {discard: true, preserveEditors: true});
  const current = documents.models.get('Shared.cs');

  assert.notEqual(current, previous);
  assert.equal(documents.get('Shared.cs').model, current);
  assert.equal(current.text, 'replacement');
  assert.equal(current.readOnly, true, 'the dependency execution lease applies to the new model');
  assert.equal(detachedOwners.length, 2);
  assert(detachedOwners.every(entry => entry.previous === previous && entry.owner === current));
  for (const {editor} of documents.views.get('Shared.cs').values()) {
    assert.equal(editor.model, current);
    assert.equal(editor.disposed, false);
    assert.equal(editor.input.readOnly, true);
  }
  running.readOnly = false;
  locks.refresh();
  assert.equal(current.readOnly, false);
  assert.throws(() => previous.setReadOnly(false), /EditorModel is disposed/);
});

test('closing a view retains its owned model, undo history and saved view state for reopening', t => {
  const {documents, session} = fixture(t, [{uri: 'Keep.cs', text: 'before'}]);
  documents.createDocument('Keep.cs');
  const model = documents.models.get('Keep.cs');
  model.setValue('after', {undoStop: true});
  documents.markSaved('Keep.cs');
  documents.close('Keep.cs');

  assert.equal(session.models.get('Keep.cs'), model);
  assert.equal(session.views.size, 0);
  documents.createDocument('Keep.cs');
  assert.equal(documents.editors.get('Keep.cs').model, model);
  assert.equal(documents.getViewState('Keep.cs').scrollTop, 17);
  assert.equal(model.undo(), true);
  assert.equal(model.text, 'before');
});

test('disposing the document owner leaves no model or editor resurrected by view cleanup', t => {
  const {documents, session} = fixture(t, [{uri: 'Close.cs', text: 'closed'}]);
  documents.createDocument('Close.cs');
  const model = documents.models.get('Close.cs');
  const editor = documents.editors.get('Close.cs');
  documents.dispose();

  assert.equal(documents.models.size, 0);
  assert.equal(documents.views.size, 0);
  assert.equal(session.views.size, 0);
  assert.equal(editor.disposed, true);
  assert.throws(() => model.setReadOnly(false), /EditorModel is disposed/);
});
