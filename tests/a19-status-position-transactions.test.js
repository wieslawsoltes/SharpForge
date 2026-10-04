import test from 'node:test';
import assert from 'node:assert/strict';
import { CodeEditor, EditorModel } from '@sharpforge/editor';
import { DocumentService } from '../apps/studio/workbench/documents.js';
import { registerStatusRegions } from '../apps/studio/workbench/status-bar.js';
import { StatusPosition } from '../apps/studio/workbench/status-position.js';

// Presentation collaborators are inert; edit transactions, modelChanged and cursor are real editor methods.
function editorView(model, onCursor) {
  const noop = () => {};
  const editor = Object.create(CodeEditor.prototype);
  Object.assign(editor, {
    model, uri: model.uri, selections: [{ anchor: 0, active: model.length }], primaryIndex: 0,
    callbacks: {}, contributions: new Set(), onCursor, decorationRevision: 0,
    largeFile: { update: noop }, highlightIndex: { update: noop }, folding: { applyChange: noop },
    bookmarks: { applyChange: noop }, changeTracking: { applyChange: noop },
    view: { layout: { invalidate: noop }, scroll: { invalidate: noop }, schedule: noop },
    presentation: { transformDecorations: noop }, bracketColors: { update: noop },
    foldingProvider: { schedule: noop }
  });
  return editor;
}

test('main fallback status survives owner-first shrink notifications before the real editor caret transforms', () => {
  const uri = 'Program.cs';
  const documents = new DocumentService({
    records: [{ uri, text: 'long original source', version: 1 }],
    createModel: record => new EditorModel(record.text, { uri: record.uri, version: record.version })
  });
  const model = documents.models.get(uri);
  assert.equal(model.cachedVisualColumnAtOffset, undefined, 'This fixture targets actual main fallback capabilities');
  assert.equal(model.visualColumnAtOffset, undefined);
  const originalLength = model.length;
  const samples = [];
  const regions = new Map();
  const disposers = [];
  const editor = editorView(model, () => samples.push({ phase: 'cursor', text: regions.get('cursor').value() }));
  registerStatusRegions({
    register(region) {
      regions.set(region.id, region);
      const dispose = region.subscribe?.(() => samples.push({ phase: 'refresh', text: region.value() }));
      if (dispose) disposers.push(dispose);
    }
  }, {
    context: () => ({ uri, caretOffset: editor.caretOffset,
      caretPosition: editor.sourceSnapshot().positionAt(editor.caretOffset), tabSize: 4 }),
    documents, tasks: { running: [], subscribe() {} }, notifications: { unread: 0, subscribe() {} },
    settings: { get() {} }, execute() {}
  });
  // The document owner subscribed during construction, before this view subscribed to its model.
  const offDocument = documents.subscribe(event => {
    if (event.type !== 'changed') return;
    samples.push({ phase: 'document', offset: editor.caretOffset, length: model.length,
      text: regions.get('cursor').value() });
  });
  const offView = model.onDidChange(change => editor.modelChanged(change));
  try {
    assert.doesNotThrow(() => editor.applyEdits([{ start: 0, end: originalLength, text: '\t中' }], {
      selections: [{ anchor: 2, active: 2 }], source: 'typing'
    }));
    assert.deepEqual(samples[0], { phase: 'document', offset: originalLength, length: 2,
      text: 'Ln 1, Col unavailable, Ch 3' });
    assert.equal(samples[1].phase, 'cursor', 'The document callback must not prevent the actual view listener completing');
    assert.equal(editor.caretOffset, 2);
    assert.deepEqual(editor.getSelections().map(({ anchor, active }) => ({ anchor, active })), [{ anchor: 2, active: 2 }]);
    assert.equal(model.text, '\t中');
    assert.equal(documents.get(uri).text, '\t中');
    assert.equal(regions.get('cursor').value(), 'Ln 1, Col 7, Ch 3');
    assert.deepEqual(samples[1], { phase: 'cursor', text: 'Ln 1, Col 7, Ch 3' });
    assert.equal(samples.length, 2, 'The actual main fallback resolves synchronously without indexing callbacks');
    assert.throws(() => model.getText(originalLength, originalLength), RangeError);
  } finally {
    offView();
    offDocument();
    for (const dispose of disposers) dispose();
    documents.dispose();
  }
});

test('main fallback preserves current column-option and source-read failures', () => {
  const model = new EditorModel('x');
  const status = new StatusPosition();
  const failure = new Error('Current source reader failed');
  const source = { length: 1, version: 1, getText() { throw failure; } };
  try {
    assert.throws(() => status.column(model, model.positionAt(1), { offset: 1, tabSize: 0 }),
      /Tab size must be between 1 and 256/);
    assert.throws(() => status.column(source, { line: 0, character: 1 }, { offset: 1 }),
      error => error === failure);
  } finally { status.dispose(); model.dispose(); }
});
