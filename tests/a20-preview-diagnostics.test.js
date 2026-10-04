import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {EditorPresentation} from '../packages/editor/src/core/presentation.js';
import {RenamePreview} from '../packages/editor/src/features/rename-preview.js';

const originalText = 'class Name {}\nMissing();';

function view(model, session = {views: new Set()}) {
  const calls = [];
  const editor = {
    model, session, disposed: false, diagnostics: [], decorationRevision: 0, decorationOwners: new Map(),
    get value() { return this.model.getText(); },
    highlightIndex: {update() {}},
    view: {layout: {reset() {}}, scroll: {reset() {}}, render() {}},
    accessibility: {update() {}}, sync() {},
    insights: {setDiagnostics(items, version) { calls.push({items, version}); }}
  };
  const presentation = new EditorPresentation(editor);
  editor.refreshPreview = () => presentation.refreshPreview();
  session.views.add(editor);
  return {editor, presentation, calls};
}

function diagnostic(source, message = 'Missing symbol') {
  const start = source.text.indexOf('Missing');
  return {code: 'CS0103', message, severity: 1,
    range: {start: source.positionAt(start), end: source.positionAt(start + 7)}};
}

function previewFixture(t) {
  const model = new EditorModel(originalText, {uri: 'A.cs'});
  const current = view(model);
  const source = model.snapshot();
  const preview = new RenamePreview(current.editor);
  t.after(() => { preview.release(); model.dispose(); });
  preview.show([{start: 6, end: 10, text: 'TemporaryLongName'}]);
  assert.notEqual(model.snapshot(), source);
  return {...current, model, source, preview};
}

test('ordinary diagnostics keep their immediate severity, range and empty-result behavior', t => {
  const model = new EditorModel(originalText, {uri: 'A.cs'});
  t.after(() => model.dispose());
  const {editor, presentation, calls} = view(model);
  const source = model.snapshot();
  presentation.setDiagnostics([diagnostic(source)]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].version, source.version);
  assert.equal(editor.diagnostics[0].severity, 'error');
  assert.equal(editor.diagnostics[0].start, originalText.indexOf('Missing'));
  assert.equal(editor.decorationOwners.get('diagnostics')[0].start, originalText.indexOf('Missing'));
  presentation.setDiagnostics([]);
  assert.deepEqual(editor.diagnostics, []);
  assert.deepEqual(editor.decorationOwners.get('diagnostics'), []);
  assert.equal(calls.length, 2);
});

test('latest pending analysis is normalized against committed source and flushed by actual preview restoration', t => {
  const {model, source, preview, editor, presentation, calls} = previewFixture(t);
  const latest = diagnostic(source, 'Latest result');
  const visualVersion = model.version;
  presentation.setDiagnostics([diagnostic(source, 'Older result')]);
  presentation.setDiagnostics([latest]);
  latest.range.start.character = 4;
  latest.message = 'Mutated after delivery';
  assert.equal(calls.length, 0);
  assert.deepEqual(editor.diagnostics, []);
  assert.equal(editor.decorationOwners.has('diagnostics'), false);

  preview.restore();

  assert.equal(model.previewActive, true, 'Restored visual source may still have an exclusive preview owner');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].version, source.version);
  assert.notEqual(calls[0].version, visualVersion);
  assert.equal(editor.diagnostics[0].message, 'Latest result');
  assert.equal(editor.diagnostics[0].start, originalText.indexOf('Missing'));
  assert.equal(editor.diagnostics[0].range.start.character, 0);
  assert.equal(presentation.pendingDiagnostics, null);
  preview.release();
  assert.equal(calls.length, 1, 'Release must not replay an already flushed result');
});

test('an empty pending result clears earlier errors when the preview releases', t => {
  const {source, preview, presentation, editor, calls} = previewFixture(t);
  presentation.setDiagnostics([diagnostic(source)]);
  preview.restore();
  assert.equal(editor.diagnostics.length, 1);
  preview.show([{start: 6, end: 10, text: 'AnotherTemporaryName'}]);
  presentation.setDiagnostics([]);
  assert.equal(calls.length, 1);
  preview.release();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].items, []);
  assert.equal(calls[1].version, source.version);
  assert.deepEqual(editor.decorationOwners.get('diagnostics'), []);
});

test('preview release repaints a secondary shared view and flushes its own pending diagnostics', t => {
  const {model, source, preview, editor} = previewFixture(t);
  const secondary = view(model, editor.session);
  secondary.presentation.setDiagnostics([diagnostic(source)]);
  assert.equal(secondary.calls.length, 0);
  preview.release();
  assert.equal(secondary.calls.length, 1);
  assert.equal(secondary.calls[0].version, source.version);
  assert.equal(secondary.editor.diagnostics[0].start, originalText.indexOf('Missing'));
});

test('a replacement model with the same URI and version never receives a previous model pending result', t => {
  const {source, preview, editor, presentation, calls} = previewFixture(t);
  presentation.setDiagnostics([diagnostic(source)]);
  const replacement = new EditorModel(originalText, {uri: source.uri, version: source.version});
  t.after(() => replacement.dispose());
  editor.model = replacement;
  presentation.refreshPreview();
  assert.equal(presentation.pendingDiagnostics, null);
  assert.equal(calls.length, 0);
  preview.release();
  assert.equal(calls.length, 0);
  presentation.setDiagnostics([diagnostic(replacement.snapshot(), 'Replacement result')]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].items[0].message, 'Replacement result');
});

test('a source committed before deferred delivery invalidates the captured pending result', t => {
  const {model, source, preview, presentation, calls} = previewFixture(t);
  presentation.setDiagnostics([diagnostic(source)]);
  model.endPreview(preview.lease);
  model.applyEdits([{start: 0, end: 0, text: '// New source\n'}]);
  presentation.refreshPreview();
  assert.equal(presentation.pendingDiagnostics, null);
  assert.equal(calls.length, 0);
  assert.notEqual(model.publishedSnapshot(), source);
});

test('a disposed presentation cannot flush or retain pending source diagnostics', t => {
  const {source, preview, editor, presentation, calls} = previewFixture(t);
  presentation.setDiagnostics([diagnostic(source)]);
  editor.disposed = true;
  preview.release();
  presentation.refreshPreview();
  assert.equal(presentation.pendingDiagnostics, null);
  assert.equal(calls.length, 0);
  presentation.setDiagnostics([diagnostic(source)]);
  assert.equal(presentation.pendingDiagnostics, null);
});
