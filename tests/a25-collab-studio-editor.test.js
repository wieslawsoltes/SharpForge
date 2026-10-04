import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText } from '../packages/text/src/index.js';
import { sourceReplacement, createStudioEditorCollaborationHost } from '../apps/studio/git-collab-editor-host.js';
import { measureCollaborationCursor, collaborationLineEnd } from '../apps/studio/git-editor-cursors.js';
import { editorFixture } from './helpers/a25-collab-studio.js';

test('source replacements reconstruct UTF-16 documents including CRLF, emoji and unpaired surrogates', () => {
  const values = ['', 'abc', 'a\r\nb', 'a😀b', 'a😁b', '\ud800', '\udc00', '\tfirst\r\nlast'];
  for (const before of values) for (const after of values) {
    const change = sourceReplacement(before, after);
    assert.equal(before.slice(0, change.start) + change.insertText + before.slice(change.start + change.deleteCount), after);
  }
  assert.deepEqual(sourceReplacement('abc', 'axc'), { start: 1, deleteCount: 1, insertText: 'x' });
  assert.deepEqual(sourceReplacement('abc', 'abc'), { start: 3, deleteCount: 0, insertText: '' });
  assert.throws(() => sourceReplacement(null, ''), TypeError);
});

test('Studio document service preserves editor callbacks, exact document edits and backward selections', () => {
  const value = editorFixture();
  const binding = createStudioEditorCollaborationHost(value.workbench, value.editor, {}, { createCursors: () => value.cursors });
  const changes = [];
  const selections = [];
  binding.onTextChange(change => changes.push(change));
  binding.onSelectionChange(selection => selections.push(selection));
  binding.applyRemoteTextChange({ start: 1, deleteCount: 1, insertText: '😀' });
  assert.equal(value.state.files[0].text, 'a😀cd');
  assert.equal(value.state.files[1].text, 'other');
  assert.equal(value.editor.value, 'a😀cd');
  assert.equal(changes.length, 1, 'shared applyEdits publishes exactly one source revision');
  assert.equal(value.editor.onChange, value.originalChange);
  assert.equal(value.editor.onCursor, value.originalCursor);
  binding.setSelection({ anchor: 4, focus: 1 });
  value.editor.input.dispatchEvent(new Event('select'));
  assert.deepEqual(binding.getSelection(), { anchor: 4, focus: 1 });
  assert.deepEqual(selections, [{ anchor: 4, focus: 1 }]);
  value.events.publish('Other.cs', 'unrelated');
  assert.equal(changes.length, 1);
  binding.dispose();
  binding.dispose();
  value.events.publish('Program.cs', 'after disposal');
  value.editor.input.dispatchEvent(new Event('select'));
  assert.equal(changes.length, 1);
  assert.equal(selections.length, 1);
  assert.equal(value.cursors.disposed, 1);
  assert.throws(() => binding.getText(), error => error.code === 'Disposed');
});

test('workspace replacement, closed documents and classic modes invalidate without editing another source', () => {
  for (const [mutate, code] of [
    [value => { value.identity = 'preview:another:1'; }, 'Conflict'],
    [value => { value.editor.uri = 'Other.cs'; }, 'Conflict'],
    [value => { value.state.files.shift(); }, 'NotFound'],
    [value => { value.classic = true; }, 'Unsupported']
  ]) {
    const value = editorFixture();
    const binding = createStudioEditorCollaborationHost(value.workbench, value.editor, {}, { createCursors: () => value.cursors });
    const errors = [];
    binding.onInvalidated(error => errors.push(error.code));
    binding.onTextChange(() => assert.fail('Invalidated source must not publish a local edit'));
    mutate(value);
    value.events.publish('Program.cs', 'foreign');
    value.events.publish('Program.cs', 'foreign again');
    assert.deepEqual(errors, [code]);
    assert.equal(binding.isCurrent(), false);
    assert.throws(() => binding.applyRemoteTextChange({ start: 0, deleteCount: 0, insertText: '!' }), error => error.code === code);
    assert.equal(value.state.files.at(-1).text, 'other');
    binding.dispose();
  }
  const classic = editorFixture();
  classic.classic = true;
  assert.throws(() => createStudioEditorCollaborationHost(classic.workbench, classic.editor, {}), error => error.code === 'Unsupported');
});

test('cursor measurement respects pixel tab stops after emoji and trims only actual line endings', () => {
  const source = new SourceText('😀\tX\r\nlast');
  const metrics = { measure: text => [...text].reduce((sum, character) => sum + (character === '😀' ? 18 : 7), 0),
    tabWidth: 28, paddingLeft: 16, paddingTop: 14, scrollLeft: 3, scrollTop: 2, lineHeight: 22 };
  assert.deepEqual(measureCollaborationCursor(source, 3, metrics), { x: 41, y: 12, line: 0 });
  assert.deepEqual(measureCollaborationCursor(source, 4, metrics), { x: 48, y: 12, line: 0 });
  assert.equal(collaborationLineEnd(source, 0), 4);
  assert.equal(collaborationLineEnd(source, 1), source.length);
  assert.deepEqual(measureCollaborationCursor(source, 999, metrics), { x: 41, y: 34, line: 1 });
  assert.deepEqual(measureCollaborationCursor(source, -1, metrics), { x: 13, y: 12, line: 0 });
});

test('unnotified bulk source replacement and debugger read-only state cannot receive a remote edit', () => {
  const value = editorFixture();
  const binding = createStudioEditorCollaborationHost(value.workbench, value.editor, {}, { createCursors: () => value.cursors });
  binding.onTextChange(() => undefined);
  value.state.files[0].text = 'restored debugger source';
  assert.throws(() => binding.applyRemoteTextChange({ start: 1, deleteCount: 1, insertText: '!' }), error => error.code === 'Conflict');
  assert.equal(value.state.files[0].text, 'restored debugger source');
  value.events.publish('Program.cs', value.state.files[0].text);
  value.state.readOnly = true;
  assert.throws(() => binding.applyRemoteTextChange({ start: 0, deleteCount: 0, insertText: '?' }), error => error.code === 'Conflict');
  assert.equal(value.state.files[0].text, 'restored debugger source');
  binding.dispose();
});

for (const native of [false, true]) {
  test(`a document reset detaches the ${native ? 'native' : 'legacy'} binding even when its editor and workspace survive`, () => {
    const value = editorFixture();
    const contributions = new Set();
    if (native) {
      value.editor.view = { viewport: {}, coordsAt() {}, layout: { rows() {} } };
      value.editor.registerContribution = contribution => {
        contributions.add(contribution);
        return () => contributions.delete(contribution);
      };
    }
    const cursors = { cleared: 0, disposed: 0,
      set(peers) { assert.deepEqual(peers, []); this.cleared++; },
      redraw() { assert.fail('A detached document must not redraw collaboration cursors'); },
      dispose() { this.disposed++; } };
    const binding = createStudioEditorCollaborationHost(value.workbench, value.editor, {}, { createCursors: () => cursors });
    const errors = [];
    binding.onInvalidated(error => errors.push(error));
    binding.onTextChange(() => assert.fail('A document reset must not become a CRDT edit'));
    binding.onSelectionChange(() => assert.fail('A detached document must not publish its selection'));
    const identity = value.identity;
    const editor = value.editor;
    let sourceReads = 0;
    value.state.files[0] = { uri: 'Program.cs', version: 2,
      get text() { sourceReads++; return 'replacement owned by the document service'; } };
    Object.defineProperty(value.state.files[1], 'text', { get() {
      assert.fail('Reset invalidation must not flatten unrelated sources');
    } });

    value.events.reset();
    assert.equal(value.identity, identity);
    assert.equal(value.editor, editor);
    assert.equal(editor.uri, 'Program.cs');
    assert.equal(binding.isCurrent(), false);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'Conflict');
    assert.match(errors[0].message, /documents were replaced.*rejoin/i);
    const detached = error => error === errors[0];
    assert.throws(() => binding.getText(), detached);
    assert.throws(() => binding.getSelection(), detached);
    assert.throws(() => binding.setSelection({ anchor: 0, focus: 0 }), detached);
    assert.throws(() => binding.applyRemoteTextChange({ start: 0, deleteCount: 0, insertText: '!' }), detached);
    assert.throws(() => binding.onTextChange(() => undefined), detached);
    assert.throws(() => binding.onSelectionChange(() => undefined), detached);

    value.events.publish('Program.cs', 'later native change');
    value.events.reset();
    value.editor.input.dispatchEvent(new Event('select'));
    for (const contribution of contributions) contribution.cursor();
    binding.setRemoteCursors([{ clientId: 'peer', anchor: 0, focus: 1 }]);
    assert.equal(errors.length, 1, 'One reset emits one invalidation diagnostic');
    assert.equal(cursors.cleared, 1);
    assert.equal(sourceReads, 0, 'Reset and detached operations never read replacement source text');
    binding.dispose();
    binding.dispose();
    assert.equal(contributions.size, 0, 'Disposal removes native cursor subscriptions');
    value.events.reset();
    value.editor.input.dispatchEvent(new Event('select'));
    assert.equal(errors.length, 1);
    assert.equal(cursors.disposed, 1);
    assert.throws(() => binding.getText(), error => error.code === 'Disposed');
  });
}
