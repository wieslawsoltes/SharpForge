import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel, EditorModelWorkspace, EditorLanguageServices } from '@sharpforge/editor';
import { createInsightContext } from '../packages/editor/src/features/context.js';
import { deferred } from './a19-session-fixtures.js';

function fixture(t, availability, providers) {
  const model = new EditorModel('class Small {}', { uri: 'Small.cs' });
  const workspace = new EditorModelWorkspace(new Map([[model.uri, model]]));
  const services = new EditorLanguageServices(providers);
  const document = { createElement: () => ({ setAttribute() {} }) };
  const editor = { uri: model.uri, model, element: { ownerDocument: document, append() {} } };
  const errors = [], statuses = [];
  const context = createInsightContext(editor, { workspace, services, languageAvailability: availability,
    onError: error => errors.push(error), onStatus: message => statuses.push(message) });
  t.after(() => { context.guard.dispose(); context.lifetime.dispose(); services.dispose(); model.dispose(); });
  return { context, errors, statuses, model };
}

test('host availability refuses custom providers before invocation and announces its explicit reason without an error toast', async t => {
  let calls = 0;
  let blocked = true;
  const requests = [];
  const current = fixture(t, request => {
    requests.push(request);
    return blocked ? { available: false, code: 'PROJECT_BOUND', reason: 'A sibling source exceeds the compiler bound.' } : { available: true };
  }, { rename: () => { calls++; return { title: 'Rename', edits: [] }; } });
  assert.equal(await current.context.safe(() => current.context.request('rename', {
    uri: 'Forged.cs', projectId: 'Chosen', offset: 6, newName: 'Next'
  })), undefined);
  assert.equal(requests[0].uri, 'Small.cs');
  assert.equal(requests[0].projectId, 'Chosen');
  assert.equal(requests[0].method, 'rename');
  assert.equal(calls, 0);
  assert.deepEqual(current.errors, []);
  assert.deepEqual(current.statuses, ['PROJECT_BOUND: A sibling source exceeds the compiler bound.']);
  blocked = false;
  assert.equal((await current.context.request('rename', { offset: 6, newName: 'Next' })).value.title, 'Rename');
  assert.equal(calls, 1);
});

test('local document and project providers remain available when the host exempts them', async t => {
  const current = fixture(t, ({ method }) => ({ available: ['readDocument', 'projects'].includes(method), reason: 'Compiler unavailable' }),
    { readDocument: () => ({ uri: 'Small.cs', version: 1 }), projects: () => [{ id: 'Chosen' }], hover: () => [] });
  current.model.applyEdits([{ start: 0, end: 0, text: 'x'.repeat(2_000_001) }]);
  assert.equal((await current.context.request('readDocument')).value.uri, 'Small.cs');
  assert.deepEqual((await current.context.request('projects')).value, [{ id: 'Chosen' }]);
  assert.equal(await current.context.request('hover'), undefined);
  assert.deepEqual(current.errors, []);
});

test('eligibility preserves cancellation and does not revive requests after editor disposal', async t => {
  const pending = deferred();
  let policyCalls = 0, signal;
  const current = fixture(t, () => { policyCalls++; return { available: true }; }, {
    hover: params => { signal = params.signal; return pending.promise; }
  });
  const controller = new AbortController();
  const request = current.context.request('hover', {}, { signal: controller.signal });
  controller.abort();
  assert.equal(signal.aborted, true);
  pending.resolve({ contents: 'late' });
  assert.equal(await request, undefined);
  current.context.lifetime.dispose();
  assert.equal(await current.context.request('hover'), undefined);
  assert.equal(policyCalls, 1);
});
