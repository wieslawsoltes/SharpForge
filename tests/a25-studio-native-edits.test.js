import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel, EditorModelWorkspace } from '@sharpforge/editor';
import { applyStudioTextEdits, restoreStudioDebugSources } from '../apps/studio/services/edits.js';
import { nativeStudioHost } from './fixtures/a25-studio-native-owner.js';

const edits = [
  { uri: 'first.cs', start: 1, end: 3, newText: 'XY' },
  { uri: 'second.cs', start: 0, end: 2, newText: 'AB' }
];

test('native edits atomically update readonly records while the owner retains revisions, baselines and undo', () => {
  const fixture = nativeStudioHost();
  const { host, owner, nativeEvents, events, counters } = fixture;
  const versions = owner.files.map(file => file.version);
  const baselines = new Map(owner.baselines);
  const result = applyStudioTextEdits(host, edits);
  assert.equal(result.changes.length, 2);
  assert.deepEqual(fixture.text(), ['aXYd', 'AByz']);
  assert.deepEqual(owner.files.map(file => file.version), versions.map(version => version + 1));
  assert.equal(owner.revision, 21);
  assert.equal(host.state.diskRevision, 6);
  assert.equal(host.state.applyingEdits, false);
  assert.equal(counters.recordSetters, 0);
  assert.deepEqual(owner.baselines, baselines);
  assert.deepEqual([...owner.dirtyFiles], ['first.cs', 'second.cs']);
  assert.deepEqual(nativeEvents.map(event => event.text), [['aXYd', 'AByz'], ['aXYd', 'AByz']]);
  assert.ok(nativeEvents.every(event => !event.applyingEdits));
  assert.deepEqual(events.map(item => item.event), [{ uri: 'first.cs', text: 'aXYd' }, { uri: 'second.cs', text: 'AByz' }]);
  assert.ok(events.every(item => item.revision === 21));
  const workspace = new EditorModelWorkspace(owner.models);
  assert.equal(workspace.getDocument('first.cs').model, owner.models.get('first.cs'));
  assert.equal(owner.models.get('first.cs').undo(), true);
  assert.equal(owner.files[0].text, 'abcd');
  assert.equal(owner.models.get('first.cs').isDirty, false);
});

test('native stale and read-only targets fail before any document or owner counter changes', () => {
  for (const mode of ['stale', 'read-only']) {
    const fixture = nativeStudioHost();
    const { owner, host } = fixture;
    const input = edits.map(edit => ({ ...edit }));
    if (mode === 'stale') input[1].version = owner.models.get('second.cs').version - 1;
    else owner.models.get('second.cs').readOnly = true;
    assert.throws(() => applyStudioTextEdits(host, input), mode === 'stale' ? /Stale/ : /read-only/);
    assert.deepEqual(fixture.text(), ['abcd', 'wxyz']);
    assert.equal(owner.revision, 19);
    assert.equal(host.state.diskRevision, 4);
    assert.equal(fixture.counters.recordSetters, 0);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.nativeEvents, []);
  }
});

test('native ownership and atomic capabilities are preflighted before readonly record setters', () => {
  class MissingCheckpoint extends EditorModel { get checkpoint() { return undefined; } }
  for (const mode of ['detached', 'editors', 'files', 'model', 'capability', 'notifications']) {
    const fixture = nativeStudioHost({ Model: mode === 'capability' ? MissingCheckpoint : EditorModel });
    const { host, owner } = fixture;
    if (mode === 'detached') delete host.docking.documents;
    if (mode === 'editors') host.editors = new Map();
    if (mode === 'files') host.state = { ...host.state, files: [...owner.files] };
    if (mode === 'model') owner.models.set('second.cs', new EditorModel('wxyz', { uri: 'second.cs' }));
    if (mode === 'notifications') host.documentEvents = {};
    assert.throws(() => applyStudioTextEdits(host, edits), TypeError);
    assert.equal(owner.files[0].text, 'abcd');
    assert.equal(owner.files[1].text, 'wxyz');
    assert.equal(owner.revision, 19);
    assert.equal(fixture.counters.recordSetters, 0);
    assert.deepEqual(fixture.nativeEvents, []);
  }
});

test('getter-only record versions without a model property reject the whole legacy batch before a text setter runs', () => {
  let assignments = 0;
  const first = { uri: 'first.cs', text: 'abcd', version: 1 };
  const second = { uri: 'second.cs', get text() { return 'wxyz'; }, set text(_) { assignments++; }, get version() { return 1; } };
  const host = { state: { files: [first, second] }, editors: new Map() };
  assert.throws(() => applyStudioTextEdits(host, edits), /native document owner/);
  assert.equal(first.text, 'abcd');
  assert.equal(first.version, 1);
  assert.equal(assignments, 0);
  assert.equal(host.state.applyingEdits, undefined);
});

test('real workspace transaction restores both model checkpoints if a later native commit fails', () => {
  const failure = new Error('Second model failed');
  class FailingModel extends EditorModel {
    commitPrepared(prepared, options) {
      if (this.uri === 'second.cs') throw failure;
      return super.commitPrepared(prepared, options);
    }
  }
  const fixture = nativeStudioHost({ Model: FailingModel });
  const versions = fixture.owner.files.map(file => file.version);
  assert.throws(() => applyStudioTextEdits(fixture.host, edits), error => error === failure);
  assert.deepEqual(fixture.text(), ['abcd', 'wxyz']);
  assert.deepEqual(fixture.owner.files.map(file => file.version), versions);
  assert.ok([...fixture.owner.models.values()].every(model => !model.canUndo && !model.isDirty));
  assert.equal(fixture.owner.revision, 19);
  assert.deepEqual(fixture.events, []);
  assert.deepEqual(fixture.nativeEvents, []);
});

test('post-commit native subscriber failures keep causal evidence and still publish committed A25 changes', () => {
  const failure = new Error('Native notification failed');
  const fixture = nativeStudioHost({ onChange: change => { if (change.model.uri === 'first.cs') throw failure; } });
  assert.throws(() => applyStudioTextEdits(fixture.host, edits), error =>
    error.code === 'DOCUMENT_COMMITTED' && error.committed === true && error.cause instanceof AggregateError &&
    error.cause.errors[0] === failure && error.errors[0] === error.cause);
  assert.deepEqual(fixture.text(), ['aXYd', 'AByz']);
  assert.equal(fixture.nativeEvents.length, 2);
  assert.equal(fixture.events.length, 2);
  assert.ok(fixture.events.every(item => item.revision === 21));
});

test('a falsy bridge failure is not swallowed and later committed documents are still notified', () => {
  const fixture = nativeStudioHost();
  fixture.host.documentEvents.subscribe(event => { if (event.uri === 'first.cs') throw undefined; });
  let caught = false;
  try { applyStudioTextEdits(fixture.host, edits); }
  catch (error) {
    caught = true;
    assert.equal(error.code, 'DOCUMENT_COMMITTED');
    assert.equal(error.committed, true);
    assert.equal(error.cause, undefined);
    assert.deepEqual(error.errors, [undefined]);
  }
  assert.equal(caught, true);
  assert.deepEqual(fixture.text(), ['aXYd', 'AByz']);
  assert.equal(fixture.events.length, 2);
});

test('native and A25 post-commit failures retain both causes and committed state', () => {
  const native = new Error('Native subscriber failed');
  const bridge = new Error('A25 subscriber failed');
  const fixture = nativeStudioHost({ onChange: change => { if (change.model.uri === 'first.cs') throw native; } });
  fixture.host.documentEvents.subscribe(event => { if (event.uri === 'first.cs') throw bridge; });
  assert.throws(() => applyStudioTextEdits(fixture.host, edits), error =>
    error.code === 'DOCUMENT_COMMITTED' && error.committed === true && error.errors.length === 2 &&
    error.cause === error.errors[0] && error.cause.errors[0] === native && error.errors[1] === bridge);
  assert.deepEqual(fixture.text(), ['aXYd', 'AByz']);
  assert.equal(fixture.events.length, 2);
});

test('debug source restoration uses one native transaction without replacing saved baselines or views', () => {
  const fixture = nativeStudioHost();
  const { host, owner } = fixture;
  const baselines = new Map(owner.baselines);
  const view = { model: owner.models.get('first.cs') };
  owner.editors.set('first.cs', view);
  restoreStudioDebugSources(host, [{ uri: 'first.cs', text: 'restored first' },
    { uri: 'second.cs', text: 'restored second' }, { uri: 'missing.cs', text: 'ignored' }]);
  assert.deepEqual(fixture.text(), ['restored first', 'restored second']);
  assert.ok(fixture.nativeEvents.every(event => event.text[1] === 'restored second'));
  assert.equal(owner.editors.get('first.cs'), view);
  assert.deepEqual(owner.baselines, baselines);
  assert.equal(host.state.buildDirty, true);
  assert.equal(owner.revision, 21);
  assert.equal(fixture.counters.recordSetters, 0);
});

test('a host with a central native notification bridge may omit the A25 document event channel', () => {
  const fixture = nativeStudioHost();
  delete fixture.host.documentEvents;
  applyStudioTextEdits(fixture.host, edits);
  assert.deepEqual(fixture.text(), ['aXYd', 'AByz']);
  assert.equal(fixture.nativeEvents.length, 2);
  assert.deepEqual(fixture.events, []);
});
