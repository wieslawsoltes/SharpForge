import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { createInsightContext } from '../packages/editor/src/features/context.js';
import { deferred } from './a19-session-fixtures.js';

function fixture(t, openDocument) {
  const model = new EditorModel('first\nsecond', { uri: 'A.cs' });
  const document = { activeElement: null, createElement: () => ({ setAttribute() {} }) };
  const original = { focus() { document.activeElement = original; } };
  document.activeElement = original;
  const editor = { uri: model.uri, model, element: { ownerDocument: document, append() {} },
    sourceSnapshot: () => model.snapshot(), goto() { throw new Error('The host must own document navigation'); } };
  const context = createInsightContext(editor, { workspace: {}, services: {}, openDocument });
  t.after(() => { context.lifetime.dispose(); model.dispose(); });
  return { context, document, original };
}

test('same-document insight navigation uses the host preview and awaits focus restoration', async t => {
  const pending = deferred();
  const calls = [];
  const { context, document, original } = fixture(t, (location, options) => {
    calls.push({ location, options });
    document.activeElement = {};
    return pending.promise;
  });
  const operation = context.navigate({ uri: 'A.cs', range: { start: { line: 1, character: 1 }, end: { line: 1, character: 4 } } },
    { preview: true, preserveFocus: true });
  assert.deepEqual(calls[0].location, { uri: 'A.cs', start: 7, end: 10,
    range: { start: { line: 1, character: 1 }, end: { line: 1, character: 4 } } });
  assert.equal(calls[0].options.preview, true);
  assert.notEqual(document.activeElement, original);
  pending.resolve('opened-view');
  assert.equal(await operation, 'opened-view');
  assert.equal(document.activeElement, original);
});

test('cross-document insight navigation preserves host group options and restores focus after failure', async t => {
  const calls = [];
  const { context, document, original } = fixture(t, async (location, options) => {
    calls.push({ location, options });
    document.activeElement = {};
    throw new Error('Destination was closed');
  });
  await assert.rejects(context.navigate({ targetUri: 'B.cs', start: 8, end: 12 },
    { preview: true, preserveFocus: true, groupId: 'second' }), /Destination was closed/);
  assert.deepEqual(calls[0].location, { targetUri: 'B.cs', uri: 'B.cs', start: 8, end: 12 });
  assert.equal(calls[0].options.groupId, 'second');
  assert.equal(document.activeElement, original);
});
