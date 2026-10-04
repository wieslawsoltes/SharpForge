import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerSession, DesignerSessionRegistry, DesignDocument, createDesign, generateDesignProject,
  guideSettings, setUserGuide, updateGuideSettings} from '@sharpforge/designer';
import {DesignerSourceSync} from '../apps/studio/designer-source-sync.js';
import {DesignerDocuments} from '../apps/studio/designer-documents.js';

function generatedSources(name, version = 1) {
  // The default design references Program.OnAction, whose declaration belongs to the generated companion file.
  return generateDesignProject(createDesign(name)).filter(file => file.path.endsWith('.cs')).map(file => ({
    uri: file.path === 'DesignedView.g.cs' ? 'View.cs' : file.path, text: file.text, version
  }));
}

function sourceView(session, files) {
  let sync;
  const view = {
    session, state: {name: 'Workspace', files, active: session.uri, revision: 1},
    get document() { return session.document; },
    ensure() {}, sourceFiles: () => files, documentHost: {},
    replace(value) {
      view.unsubscribe?.();
      const previous = session.document;
      session.document = new DesignDocument(value);
      view.unsubscribe = session.document.subscribe(event => sync.designChanged(event));
      previous.dispose();
    }
  };
  sync = new DesignerSourceSync(view);
  session.sourceSync = sync;
  session.own('test source observer', () => view.unsubscribe?.());
  return sync;
}

const recoveredGuides = {
  version: 1, gridSize: .25, gridVisible: false, snapGrid: false, snapGuides: true, snapSiblings: false, tolerance: 3.5,
  guides: [{id: 'vertical', axis: 'x', position: 122.5}, {id: 'horizontal', axis: 'y', position: -20}]
};

test('guide recovery survives actual C# source initialization and reconnect without dirtying source or model history', async () => {
  const files = generatedSources('Recovered CSharp view');
  const before = structuredClone(files);
  const text = files.find(file => file.uri === 'View.cs').text;
  const registry = new DesignerSessionRegistry();
  registry.restore({version: 1, documents: [{uri: 'View.cs', mode: 'split', guides: recoveredGuides}]}, {files});
  const session = registry.open('View.cs', {viewState: {snap: 64}});
  const placeholder = session.document;
  const sync = sourceView(session, files);
  await sync.connect('View.cs');
  session.applyRecovery({final: true});
  assert.equal(session.document.node('action').events.Click, 'Program.OnAction');
  assert.equal(placeholder.disposed, true);
  assert.deepEqual(guideSettings(session.document.value), recoveredGuides);
  assert.equal(session.document.revision, 0);
  assert.equal(session.document.undoStack.length, 0);
  assert.equal(session.pendingGuides, null);
  assert.equal(sync.dirty(), false);
  assert.equal(sync.protocol.sourceDirty, false);
  assert.equal(sync.protocol.source.text, text);
  assert.equal(sync.protocol.document.designer, undefined);
  assert.deepEqual(files, before);
  await sync.connect('View.cs');
  assert.deepEqual(guideSettings(session.document.value), recoveredGuides);
  assert.equal(sync.dirty(), false);
  registry.dispose();
  assert.throws(() => session.applyRecovery(), /disposed/);
});

test('guide-only edits, undo and redo request workspace persistence while C# stays synchronized', async () => {
  const files = generatedSources('Guide changes');
  const before = structuredClone(files);
  const events = [];
  const documents = new DesignerDocuments({
    state: {active: 'View.cs', files}, createTools() { throw new Error('No DOM host is needed'); }, openSource() {},
    onChange: event => events.push(event)
  });
  const session = documents.registry.open('View.cs');
  const sync = sourceView(session, files);
  await sync.connect('View.cs');
  session.applyRecovery({final: true});
  events.length = 0;
  setUserGuide(session.document, {id: 'ruler', axis: 'x', position: 96});
  session.document.undo();
  session.document.undo(true);
  const guideEvents = events.filter(event => event.kind === 'change' && event.event.changed?.includes('guides'));
  assert.equal(guideEvents.length, 3);
  assert.deepEqual(documents.snapshot().documents[0].guides.guides, [{id: 'ruler', axis: 'x', position: 96}]);
  session.document.select(session.document.value.root);
  assert.equal(events.filter(event => event.kind === 'change' && event.event.changed?.includes('guides')).length, 3);
  assert.equal(sync.dirty(), false);
  assert.equal(sync.protocol.sourceDirty, false);
  assert.equal(sync.designTimer, null);
  assert.deepEqual(files, before);
  documents.dispose();
});

test('two inactive C# documents recover their own guide settings from detached JSON snapshots', () => {
  const original = new DesignerSessionRegistry();
  const first = original.open('A.cs');
  const second = original.open('B.cs');
  updateGuideSettings(first.document, recoveredGuides);
  updateGuideSettings(second.document, {gridSize: 1024, tolerance: 100, guides: [{id: 'other', axis: 'y', position: 1_000_000}]});
  const saved = JSON.parse(JSON.stringify(original.snapshot()));
  const firstSnapshot = saved.documents.find(item => item.uri === 'A.cs');
  firstSnapshot.guides.guides[0].position = 150;
  assert.equal(guideSettings(first.document.value).guides[0].position, 122.5, 'snapshot does not retain mutable model references');
  original.dispose();
  const restored = new DesignerSessionRegistry();
  restored.restore(saved, {files: ['A.cs', 'B.cs']});
  const recoveredA = restored.open('A.cs');
  const recoveredB = restored.open('B.cs');
  const placeholderA = recoveredA.document;
  const placeholderB = recoveredB.document;
  recoveredA.document = new DesignDocument(createDesign('Source A'));
  recoveredB.document = new DesignDocument(createDesign('Source B'));
  placeholderA.dispose();
  placeholderB.dispose();
  recoveredA.applyRecovery({final: true});
  recoveredB.applyRecovery({final: true});
  assert.equal(guideSettings(recoveredA.document.value).guides[0].position, 150);
  assert.equal(guideSettings(recoveredA.document.value).gridSize, .25);
  assert.deepEqual(guideSettings(recoveredB.document.value).guides, [{id: 'other', axis: 'y', position: 1_000_000}]);
  assert.equal(guideSettings(recoveredB.document.value).gridSize, 1024);
  assert.equal(recoveredA.document.undoStack.length, 0);
  assert.equal(recoveredB.document.undoStack.length, 0);
  restored.dispose();
});

test('remounting a source document preserves guides, while deletion and workspace reset remove recovery', () => {
  const files = [{uri: 'View.cs', text: 'class View {}'}];
  const documents = new DesignerDocuments({
    state: {active: 'View.cs', files}, createTools() { throw new Error('No DOM host is needed'); }, openSource() {}
  });
  const first = documents.registry.open('View.cs');
  updateGuideSettings(first.document, recoveredGuides);
  documents.close('View.cs', {preserveState: true});
  assert.equal(first.document.disposed, true);
  const reopened = documents.registry.open('View.cs');
  reopened.applyRecovery({final: true});
  assert.deepEqual(guideSettings(reopened.document.value), recoveredGuides);
  documents.close('View.cs', {preserveState: true});
  documents.syncFiles([]);
  assert.deepEqual(documents.snapshot().documents, []);
  const fresh = documents.registry.open('View.cs');
  assert.equal(fresh.snapshot().guides, undefined);
  documents.close('View.cs', {preserveState: true});
  documents.reset();
  assert.deepEqual(documents.snapshot().documents, []);
  documents.dispose();
});

test('malformed or newer guide recovery is ignored and unknown metadata is not retained', () => {
  const invalid = [
    {version: 2}, {gridSize: 0}, {gridSize: Infinity}, {tolerance: 101}, {snapGrid: 'false'},
    {guides: new Array(257)}, {guides: [{id: 'same', axis: 'x', position: 0}, {id: 'same', axis: 'y', position: 1}]},
    {guides: [{id: 'bad', axis: 'z', position: 0}]}, {guides: [{id: 'bad', axis: 'x', position: 1_000_001}]}
  ];
  for (const guides of invalid) {
    const session = new DesignerSession('View.cs', {viewState: {guides}});
    assert.equal(session.snapshot().guides, undefined);
    assert.equal(session.document.value.designer?.guides, undefined);
    session.dispose();
  }
  const session = new DesignerSession('View.cs', {viewState: {guides: {
    ...recoveredGuides, unrelated: 'x'.repeat(1_000_000), callback() {},
    guides: [{id: 'safe', axis: 'x', position: 1, callback() {}}]
  }}});
  const snapshot = session.snapshot();
  assert.equal(snapshot.guides.unrelated, undefined);
  assert.equal(snapshot.guides.callback, undefined);
  assert.deepEqual(snapshot.guides.guides, [{id: 'safe', axis: 'x', position: 1}]);
  assert.ok(JSON.stringify(snapshot).length < 1000);
  session.dispose();
  const boundary = new DesignerSession('Boundary.cs', {viewState: {guides: {
    ...recoveredGuides,
    guides: Array.from({length: 256}, (_, index) => ({
      id: 'guide-' + index, axis: index % 2 ? 'x' : 'y', position: index % 2 ? -1_000_000 : 1_000_000
    }))
  }}});
  assert.equal(boundary.snapshot().guides.guides.length, 256);
  boundary.dispose();
});

test('unopened recovery is already sanitized and snapshot mutation cannot alter its pending guide state', () => {
  const registry = new DesignerSessionRegistry();
  registry.restore({version: 1, documents: [{uri: 'View.cs', unknown: 'x'.repeat(1_000_000), guides: {
    ...recoveredGuides, unrelated: 'x'.repeat(1_000_000)
  }}]}, {files: ['View.cs']});
  const saved = registry.snapshot();
  assert.equal(saved.documents[0].unknown, undefined);
  assert.equal(saved.documents[0].guides.unrelated, undefined);
  assert.ok(JSON.stringify(saved).length < 1500);
  saved.documents[0].guides.guides[0].position = 900;
  const opened = registry.open('View.cs');
  assert.equal(guideSettings(opened.document.value).guides[0].position, 122.5);
  registry.dispose();
});

test('the guide boundary remains recoverable after a failed initial C# parse', async () => {
  const files = [{uri: 'View.cs', text: 'class View {', version: 1}];
  const session = new DesignerSession('View.cs', {viewState: {guides: recoveredGuides}});
  const sync = sourceView(session, files);
  await assert.rejects(sync.connect('View.cs'));
  assert.deepEqual(session.snapshot().guides, recoveredGuides);
  files.splice(0, files.length, ...generatedSources('Repaired', 2));
  await sync.connect('View.cs');
  session.applyRecovery({final: true});
  assert.deepEqual(guideSettings(session.document.value), recoveredGuides);
  assert.equal(sync.dirty(), false);
  session.dispose();
});
