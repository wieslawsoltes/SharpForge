import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDesignerSourceTransaction, applyStudioSourceChange} from '../apps/studio/designer-source-transaction.js';
import {captureDesignerEditorRollback, restoreDesignerEditorRollback} from '../apps/studio/designer-editor-state.js';
import {editorModelView} from './fixtures/a18-editor-model-view.js';

function workspace(context) {
  const editors = new Map(['A.cs', 'B.cs'].map(uri => {
    const editor = editorModelView('before ' + uri, uri);
    editor.setValue('current ' + uri);
    editor.setValue('pending ' + uri);
    editor.model.undo();
    editor.setSelections([{anchor: 3, active: 1}, {anchor: 7, active: 9}], {primaryIndex: 1});
    editor.view.scrollTo({top: 90, left: 12});
    return [uri, editor];
  }));
  context.after(() => { for (const editor of editors.values()) editor.dispose(); });
  const state = {files: [...editors].map(([uri, editor]) => ({uri, text: editor.value, version: 9})),
    revision: 18, diskRevision: 7, buildDirty: false, readOnly: false, applyingEdits: false,
    breakpoints: {'A.cs': [{line: 2, enabled: true}]}, dirtyFiles: new Set(['B.cs'])};
  const edits = state.files.map(file => ({uri: file.uri, start: 0, end: 7, newText: 'updated', version: file.version}));
  const apply = (changes = edits, remapBreakpoints = (_before, _after, points) => points.map(point => ({...point, line: point.line + 1}))) =>
    applyDesignerSourceTransaction({state, editors, edits: changes, remapBreakpoints});
  return {state, editors, edits, apply};
}

function snapshot({state, editors}) {
  return {files: structuredClone(state.files), revision: state.revision, diskRevision: state.diskRevision,
    buildDirty: state.buildDirty, applyingEdits: state.applyingEdits, dirty: [...state.dirtyFiles],
    breakpoints: structuredClone(state.breakpoints),
    editors: [...editors].map(([uri, editor]) => ({uri, value: editor.value, version: editor.model.version,
      undo: editor.model.undoStack.checkpoint(), selections: editor.getSelections(), primaryIndex: editor.primaryIndex,
      top: editor.view.scrollTop, left: editor.view.viewport.scrollLeft}))};
}

test('A18 source transaction publishes every file and EditorModel before any participant notification', context => {
  const host = workspace(context);
  const versions = [...host.editors.values()].map(editor => editor.model.version);
  const seen = [];
  for (const editor of host.editors.values()) editor.model.onDidChange(() => {
    seen.push(editor.uri);
    assert.equal(host.state.applyingEdits, true);
    assert.ok(host.state.files.every(file => file.text === host.editors.get(file.uri).value && file.text.startsWith('updated')));
  });
  assert.deepEqual(host.apply(), ['A.cs', 'B.cs']);
  assert.deepEqual(seen, ['A.cs', 'B.cs']);
  assert.deepEqual(host.state.files.map(file => file.version), [10, 10]);
  assert.deepEqual([...host.editors.values()].map(editor => editor.model.version), versions.map(version => version + 1));
  assert.equal(host.state.revision, 19);
  assert.equal(host.state.diskRevision, 8);
  assert.equal(host.state.buildDirty, true);
  assert.equal(host.state.applyingEdits, false);
  assert.equal(host.state.breakpoints['A.cs'][0].line, 3);
  assert.deepEqual([...host.state.dirtyFiles], ['B.cs', 'A.cs']);
});

test('A18 later notification failure rolls back all source versions, redo histories, breakpoints, carets and scroll', context => {
  const host = workspace(context);
  const before = snapshot(host);
  const original = new Error('Second view could not publish');
  host.editors.get('B.cs').model.onDidChange(() => { throw original; });
  assert.throws(() => host.apply(), error => error === original);
  assert.deepEqual(snapshot(host), before);
  assert.ok([...host.editors.values()].every(editor => editor.model.canRedo && editor.refreshes === 1));
  const editor = host.editors.get('A.cs');
  editor.model.redo();
  assert.equal(editor.value, 'pending A.cs');
});

test('A18 invalid later edits and read-only models fail before committing any file or history', context => {
  const host = workspace(context);
  let events = 0;
  for (const editor of host.editors.values()) editor.model.onDidChange(() => events++);
  const before = snapshot(host);
  for (const patch of [{version: 8}, {start: -1}, {end: 1000}, {newText: null}]) {
    assert.throws(() => host.apply([host.edits[0], {...host.edits[1], ...patch}]));
    assert.deepEqual(snapshot(host), before);
  }
  host.editors.get('B.cs').model.readOnly = true;
  assert.throws(() => host.apply(), /read.only/i);
  assert.deepEqual(snapshot(host), before);
  assert.equal(events, 0);
});

test('A18 source transaction rejects independently newer model snapshots without rolling them back', context => {
  const host = workspace(context);
  const before = structuredClone(host.state.files);
  const editor = host.editors.get('A.cs');
  let calls = 0;
  assert.throws(() => host.apply(host.edits, (_before, _after, points) => {
    if (calls++ === 1) editor.setValue('Independent view edit');
    return points;
  }), /Source changed/);
  assert.equal(editor.value, 'Independent view edit');
  assert.deepEqual(host.state.files, before);
  assert.equal(host.state.applyingEdits, false);
});

test('A18 no-op edits do not create model history, dirty state or workspace revisions', context => {
  const host = workspace(context);
  const before = snapshot(host);
  assert.deepEqual(host.apply(host.state.files.map(file => ({uri: file.uri, version: file.version,
    start: 0, end: file.text.length, newText: file.text}))), []);
  assert.deepEqual(snapshot(host), before);
});

test('A18 rollback retains the initiating error if a view cannot restore and still restores every source model', context => {
  const host = workspace(context);
  const before = snapshot(host);
  const original = new Error('Cannot publish B');
  const cleanup = new Error('Cannot repaint A');
  host.editors.get('B.cs').model.onDidChange(() => { throw original; });
  host.editors.get('A.cs').restoreViewCheckpoint = () => { throw cleanup; };
  assert.throws(() => host.apply(), error => {
    assert.equal(error.cause, original);
    assert.deepEqual(error.errors, [original, cleanup]);
    return true;
  });
  assert.deepEqual(host.state.files, before.files);
  for (const saved of before.editors) {
    const editor = host.editors.get(saved.uri);
    assert.equal(editor.value, saved.value);
    assert.equal(editor.model.version, saved.version);
    assert.deepEqual(editor.model.undoStack.checkpoint(), saved.undo);
  }
});

test('A18 short-lived editor rollback cannot restore a checkpoint into another source model', context => {
  const host = workspace(context);
  const first = host.editors.get('A.cs');
  const second = host.editors.get('B.cs');
  const saved = captureDesignerEditorRollback(first);
  const other = second.model.snapshot();
  assert.throws(() => restoreDesignerEditorRollback(second, saved), /replaced editor model/);
  assert.equal(second.model.snapshot(), other);
});

test('A18 deferred native callbacks after commit or rollback cannot create duplicate workspace revisions', context => {
  const host = workspace(context);
  const publish = uri => applyStudioSourceChange({state: host.state, uri, text: host.editors.get(uri).value,
    remapBreakpoints: (_before, _after, points) => points});
  host.apply();
  const committed = snapshot(host);
  assert.equal(publish('A.cs'), false);
  assert.equal(publish('B.cs'), false);
  assert.deepEqual(snapshot(host), committed);
  const stop = host.editors.get('B.cs').model.onDidChange(() => { throw new Error('Rejected view notification'); });
  assert.throws(() => host.apply(host.state.files.map(file => ({uri: file.uri, version: file.version,
    start: 0, end: 7, newText: 'aborted'}))), /Rejected view/);
  stop();
  assert.equal(publish('A.cs'), false);
  assert.equal(publish('B.cs'), false);
  assert.deepEqual(snapshot(host), committed);
  const editor = host.editors.get('A.cs');
  editor.setValue(editor.value + ' typed');
  assert.equal(publish('A.cs'), true);
  assert.equal(host.state.revision, committed.revision + 1);
  assert.equal(host.state.files[0].text, editor.value);
});
