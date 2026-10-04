import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerSession, DesignerSessionRegistry, DesignDocument, createDesign, normalizeDesignerViewState} from '@sharpforge/designer';

test('two designer sessions isolate revisions, history, selection, zoom and source synchronization', () => {
  const first = new DesignerSession('ViewA.cs');
  const second = new DesignerSession('ViewB.cs');
  const before = second.snapshot();
  first.document.select('action');
  first.document.setProperty('Width', 312);
  first.zoom = 1.25;
  first.mode = 'layout';
  first.snap = 3;
  first.preview = true;
  first.sourceSync = {state: 'design-dirty', dispose() { this.state = 'disposed'; }};
  assert.equal(first.document.revision, 1);
  assert.equal(first.document.undoStack.length, 1);
  assert.deepEqual(second.snapshot(), before);
  assert.equal(second.document.revision, 0);
  assert.equal(second.document.undoStack.length, 0);
  assert.equal(second.sourceSync, null);
  first.document.undo();
  assert.equal(first.document.node('action').properties.Width, 160);
  assert.equal(second.document.node('action').properties.Width, 160);
  first.dispose();
  second.dispose();
});

test('view changes do not dirty model history and emit scoped change events', () => {
  const session = new DesignerSession('View.cs');
  const events = [];
  session.subscribe(event => events.push(event));
  assert.equal(session.setViewState({mode: 'split', ratio: .7}), true);
  assert.equal(session.setViewState({mode: 'split', ratio: .7}), false);
  assert.equal(session.document.revision, 0);
  assert.equal(session.document.undoStack.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].uri, 'View.cs');
  assert.equal(events[0].kind, 'view');
  session.dispose();
});

test('session rejects invalid identity and document assignment; view bounds are finite and stable', () => {
  for (const uri of ['', null, 'bad\0uri', 'a'.repeat(4097)]) assert.throws(() => new DesignerSession(uri), TypeError);
  const session = new DesignerSession('folder/%20View.cs');
  assert.equal(session.uri, 'folder/%20View.cs');
  assert.throws(() => { session.document = {}; }, TypeError);
  session.setViewState({ratio: -3, zoom: Infinity, snap: 0, scrollTop: Number.NaN, mode: 'unknown'});
  assert.equal(session.viewState.ratio, .1);
  assert.equal(session.zoom, .8);
  assert.equal(session.snap, .25);
  assert.equal(session.viewState.scrollTop, 0);
  assert.equal(session.viewState.mode, 'code');
  assert.deepEqual(normalizeDesignerViewState({selection: ['a', 'a', 1]}).selection, ['a']);
  session.dispose();
  assert.throws(() => { session.zoom = 2; }, /disposed/);
  assert.throws(() => session.beginOperation('read'), /disposed/);
});

test('registry survives tab changes and closes only removed documents with all owned resources', () => {
  const registry = new DesignerSessionRegistry();
  const disposed = [];
  const first = registry.open('A.cs');
  const second = registry.open('B.cs');
  const third = registry.open('C.cs');
  assert.equal(registry.open('B.cs'), second);
  second.own('resize', {disconnect() { disposed.push('resize'); }});
  second.own('winui', {dispose() { disposed.push('winui'); }});
  second.sourceSync = {dispose() { disposed.push('sync'); }};
  const pending = new Map();
  const scheduler = {setTimeout(callback) { pending.set(1, callback); return 1; }, clearTimeout(id) { pending.delete(id); }};
  second.schedule('source', () => disposed.push('unexpected timer'), 100, scheduler);
  const operation = second.beginOperation('compile');
  registry.active = first;
  registry.active = 'B.cs';
  registry.active = third;
  assert.equal(registry.size, 3);
  registry.syncFiles([{uri: 'A.cs'}, {uri: 'C.cs'}]);
  assert.equal(registry.size, 2);
  assert.equal(registry.active, third);
  assert.equal(second.disposed, true);
  assert.equal(operation.signal.aborted, true);
  assert.equal(operation.current(), false);
  assert.equal(pending.size, 0);
  assert.deepEqual(disposed, ['sync', 'winui', 'resize']);
  second.dispose();
  assert.equal(disposed.length, 3);
  registry.close('C.cs');
  assert.equal(registry.active, null);
  registry.dispose();
});

test('latest per-session operation invalidates stale work without cancelling another document', () => {
  const first = new DesignerSession('A.cs');
  const second = new DesignerSession('B.cs');
  const older = first.beginOperation('parse');
  const independent = second.beginOperation('parse');
  const newer = first.beginOperation('parse');
  assert.equal(older.signal.aborted, true);
  assert.equal(newer.current(), true);
  assert.equal(independent.current(), true);
  older.finish();
  assert.equal(newer.current(), true);
  first.dispose();
  assert.equal(newer.current(), false);
  assert.equal(independent.current(), true);
  second.dispose();
});

test('resource disposal continues after failure and reports the aggregate error', () => {
  const session = new DesignerSession('A.cs');
  let released = false;
  session.own('last', () => { released = true; });
  session.own('failing', () => { throw new Error('bad host'); });
  assert.throws(() => session.dispose(), AggregateError);
  assert.equal(released, true);
  assert.equal(session.resources.size, 0);
  session.dispose();
});

test('recovery preserves URI-specific views and drops stale selection and deleted documents', () => {
  const registry = new DesignerSessionRegistry();
  registry.restore({version: 1, activeUri: 'A.cs', documents: [
    {uri: 'A.cs', mode: 'split', zoom: 1.25, ratio: .7, selection: ['action', 'deleted'], scrollLeft: 42, scrollTop: 81},
    {uri: 'B.cs', mode: 'design', zoom: .5, selection: ['caption']},
    {uri: 'Gone.cs', mode: 'design'}
  ]}, {files: ['A.cs', 'B.cs']});
  const first = registry.open('A.cs');
  first.document = new DesignDocument(createDesign('Restored A'));
  first.applySelection({final: true});
  const second = registry.open('B.cs');
  second.applySelection({final: true});
  assert.equal(first.viewState.mode, 'split');
  assert.equal(first.zoom, 1.25);
  assert.equal(first.viewState.scrollTop, 81);
  assert.deepEqual(first.document.selection, ['action']);
  assert.equal(second.zoom, .5);
  assert.deepEqual(second.document.selection, ['caption']);
  assert.equal(registry.snapshot().documents.length, 2);
  assert.equal(registry.restore({version: 999, documents: []}), false);
  registry.dispose();
});

test('registry enforces capacity, exact case-sensitive identities, and no activation of missing sessions', () => {
  const registry = new DesignerSessionRegistry({maxSessions: 2});
  registry.open('View.cs');
  registry.open('view.cs');
  assert.equal(registry.size, 2);
  assert.throws(() => registry.open('Third.cs'), /limit/);
  assert.throws(() => registry.activate('Missing.cs'), /not open/);
  assert.equal(registry.close('Missing.cs'), false);
  registry.dispose();
  assert.throws(() => registry.open('View.cs'), /disposed/);
});

test('recovery survives a placeholder with the same node ID before source initialization', () => {
  const session = new DesignerSession('View.cs', {viewState: {selection: ['action']}});
  const realDocument = new DesignDocument(createDesign('Source-backed view'));
  assert.deepEqual(realDocument.selection, ['window']);
  session.document = realDocument;
  session.applySelection({final: true});
  assert.deepEqual(session.document.selection, ['action']);
  session.document.select('caption');
  assert.deepEqual(session.snapshot().selection, ['caption']);
  session.dispose();
});
