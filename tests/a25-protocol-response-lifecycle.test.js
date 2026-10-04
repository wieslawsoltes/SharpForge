import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { HttpGitTransport } from '../packages/git/src/transport/http.js';
import { gitRequest } from '../packages/git/src/transport/request.js';

const url = 'https://git.test/project.git/git-upload-pack';

function streamedResponse(status, { closed = false, cancelFailure } = {}) {
  const state = { cancellations: [] };
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('response bytes'));
      if (closed) controller.close();
    },
    cancel(reason) {
      state.cancellations.push(reason);
      if (cancelFailure) throw cancelFailure;
    }
  });
  const transport = new HttpGitTransport({ origins: ['https://git.test'], fetch: async (_, request) => {
    state.fetchSignal = request.signal;
    return new Response(body, { status });
  } });
  return { state, body, transport };
}

test('rejected HTTP statuses cancel unread bodies and release the full response deadline and abort listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [status, code] of [[401, 'Auth'], [403, 'Auth'], [404, 'NotFound'], [409, 'Conflict'], [500, 'Network']]) {
    const controller = new AbortController();
    const { state, body, transport } = streamedResponse(status);
    let failure;
    await assert.rejects(gitRequest(transport, { url, signal: controller.signal }), error => {
      failure = error;
      assert.equal(error.code, code);
      assert.deepEqual(error.details, { status, origin: 'https://git.test' });
      return true;
    });
    assert.deepEqual(state.cancellations, [failure]);
    assert.equal(body.locked, false);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    t.mock.timers.tick(120000);
    assert.equal(state.fetchSignal.aborted, false, 'the completed error response must not retain its 120-second deadline');
  }
});

test('an upstream cancellation failure cannot replace the HTTP error or retain its response resources', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const { state, body, transport } = streamedResponse(401, { cancelFailure: new Error('upstream cancellation failed') });
  await assert.rejects(gitRequest(transport, { url, signal: controller.signal }), { code: 'Auth', message: 'Git HTTP request failed' });
  assert.equal(state.cancellations.length, 1);
  assert.equal(body.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(120000);
  assert.equal(state.fetchSignal.aborted, false);
});

test('a successful response retains cancellation until the caller consumes its body', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const { state, body, transport } = streamedResponse(200, { closed: true });
  const response = await gitRequest(transport, { url, signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  assert.equal(await response.text(), 'response bytes');
  assert.deepEqual(state.cancellations, []);
  assert.equal(body.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(120000);
  assert.equal(state.fetchSignal.aborted, false);
});
