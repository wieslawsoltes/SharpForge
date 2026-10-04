import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {DocumentService} from '../apps/studio/workbench/documents.js';
import {WorkbenchStatusBar, registerStatusRegions} from '../apps/studio/workbench/status-bar.js';
import {StatusPosition} from '../apps/studio/workbench/status-position.js';
import {sessionDomRoot} from './a19-session-dom-fixture.js';

const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, text) {
  const documents = new DocumentService({records: [{uri: 'View.cs', text}],
    createModel: record => new EditorModel(record.text, {uri: record.uri})});
  const model = documents.models.get('View.cs');
  const errors = [];
  const bar = new WorkbenchStatusBar(sessionDomRoot(), {onError: error => errors.push(error)});
  const context = {uri: 'View.cs', caretOffset: model.length, caretPosition: model.positionAt(model.length), tabSize: 4};
  registerStatusRegions(bar, {
    context: () => context, documents,
    tasks: {running: [], subscribe: () => () => {}},
    notifications: {unread: 0, subscribe: () => () => {}},
    settings: {get: () => null}, execute() {}
  });
  t.after(() => { bar.dispose(); documents.dispose(); });
  return {documents, model, bar, context, errors, cursor: () => bar.regions.get('cursor').node};
}

test('a shorter document updates status before the editor publishes its new caret without stopping model listeners', async t => {
  const {documents, model, bar, context, errors, cursor} = fixture(t, 'old line\n' + 'x'.repeat(80));
  context.visualColumn = 80;
  const originalOffset = context.caretOffset;
  const order = [];
  const interim = [];
  documents.subscribe(event => {
    if (event.type !== 'changed') return;
    order.push('document');
    bar.update();
    interim.push({text: cursor().textContent, offset: context.caretOffset});
  });
  model.onDidChange(() => order.push('later model listener'));
  model.onDidChangeSelection(() => {
    order.push('selection');
    context.caretOffset = model.primarySelection.active;
    context.caretPosition = model.positionAt(context.caretOffset);
    delete context.visualColumn;
    bar.update();
  });
  const replacement = 'line\n\t中e\u0301\u200b😀';
  assert.doesNotThrow(() => model.applyEdits([{start: 0, end: model.length, text: replacement}], {
    selections: [{anchor: replacement.length, active: replacement.length}], undoStop: true
  }));
  assert.deepEqual(order, ['document', 'later model listener', 'selection']);
  assert.equal(interim[0].offset, originalOffset, 'status cannot mutate the editor context during document delivery');
  assert.match(interim[0].text, /^Ln 2, Col (pending|10), Ch 8$/);
  await flush();
  assert.equal(cursor().textContent, 'Ln 2, Col 10, Ch 8');
  assert.equal(model.snapshot().statistics.textMaterialized, false);

  model.setSelections([{anchor: 6, active: 6}]);
  await flush();
  assert.equal(cursor().textContent, 'Ln 2, Col 5, Ch 2', 'the real caret event supersedes the transient endpoint');
  context.tabSize = 8;
  bar.update();
  await flush();
  assert.equal(cursor().textContent, 'Ln 2, Col 9, Ch 2');
  assert.deepEqual(errors, []);
});

test('status derives current line and grapheme position instead of retaining a stale explicit visual column', async t => {
  const {model, bar, context, cursor, errors} = fixture(t, '\t中e\u0301😀');
  context.caretOffset = model.length - 1;
  context.caretPosition = {line: 4, character: 100};
  context.visualColumn = 900;
  bar.update();
  await flush();
  assert.equal(cursor().textContent, 'Ln 1, Col 8, Ch 6');
  assert.equal(model.snapshot().statistics.textMaterialized, false);
  assert.deepEqual(errors, []);
});

test('status clamps transient empty-document endpoints and hides malformed offsets without changing model selection', async t => {
  const {documents, model, bar, context, cursor, errors} = fixture(t, 'text');
  documents.subscribe(event => { if (event.type === 'changed') bar.update(); });
  model.setValue('');
  const selections = model.selections;
  assert.equal(cursor().textContent, 'Ln 1, Col 1, Ch 1');
  context.caretOffset = -8;
  context.caretPosition = {line: 7, character: 2};
  bar.update();
  assert.equal(cursor().textContent, 'Ln 1, Col 1, Ch 1');
  for (const offset of [NaN, Infinity, 0.5, '1']) {
    context.caretOffset = offset;
    bar.update();
    assert.equal(cursor().hidden, true);
  }
  context.caretOffset = 0;
  bar.update();
  assert.equal(cursor().hidden, false);
  assert.equal(model.selections, selections);
  await flush();
  assert.deepEqual(errors, []);
});

test('StatusPosition declines invalid UI offsets while the indexed model retains strict bounds', () => {
  const model = new EditorModel('\t中');
  const status = new StatusPosition();
  for (const offset of [-1, model.length + 1, NaN, Infinity, 1.5]) {
    assert.equal(status.column(model, {line: 0, character: 0}, {offset, visualColumn: 23}), null);
    assert.throws(() => model.cachedVisualColumnAtOffset(offset), RangeError);
  }
  assert.equal(status.column(model, {line: 0, character: -1}, {offset: 0}), null);
  assert.equal(status.column(model, {line: 0, character: 2}, {offset: 1}), null);
  assert.equal(status.column(model, {line: 0, character: 0}, {offset: 0}), 0);
  status.dispose();
  model.dispose();
});

test('an invalid status request cancels pending exact column work and cannot publish stale completion', async () => {
  const continuations = [];
  const model = new EditorModel('x'.repeat(100), {visualColumns: {
    chunkSize: 16, yieldAfterUnits: 16, now: () => 0,
    schedule: () => new Promise(resolve => continuations.push(resolve))
  }});
  let updates = 0;
  const errors = [];
  const status = new StatusPosition({onChange: () => updates++, onError: error => errors.push(error)});
  assert.equal(status.column(model, {line: 0, character: model.length}, {offset: model.length}), null);
  await Promise.resolve();
  assert.equal(status.pending, true);
  assert.equal(continuations.length, 1);
  assert.equal(status.column(model, {line: 0, character: 0}, {offset: model.length + 1}), null);
  assert.equal(status.pending, false);
  continuations.shift()();
  await flush();
  assert.equal(updates, 0);
  assert.deepEqual(errors, []);
  assert.equal(status.column(model, {line: 0, character: 0}, {offset: 0}), 0);
  status.dispose();
  model.dispose();
});
