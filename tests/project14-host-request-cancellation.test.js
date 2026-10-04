import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeUIBridge} from '../apps/studio/workers/ui-bridge.js';

test('cancellation removes unsent requests and posts one cancellation for requests already owned by the host', async () => {
  const messages = [], bridge = new RuntimeUIBridge({post: value => messages.push(value), wake() {}});
  const queued = new AbortController();
  const first = bridge.request('clipboard', {method: 'GetContent'}, {signal: queued.signal});
  const firstRejected = assert.rejects(first, {name: 'AbortError'});
  queued.abort();
  await firstRejected;
  assert.equal(bridge.pending.size, 0);
  assert.equal(bridge.requests.length, 0);
  bridge.attach({}, 3);
  bridge.flush();
  assert.equal(messages.length, 0);
  const sent = new AbortController();
  const second = bridge.runtimeOptions().uiHostRequest('clipboard', {method: 'GetContent'}, {signal: sent.signal});
  const secondRejected = assert.rejects(second, {name: 'AbortError'});
  bridge.flush();
  const requestId = messages[0].requestId;
  sent.abort();
  await secondRejected;
  assert.deepEqual(messages.map(value => value.event), ['uiHostRequest', 'uiHostCancel']);
  assert.deepEqual(messages[1], {event: 'uiHostCancel', sessionId: 3, requestId});
  assert.equal(bridge.respond({requestId, result: 'stale'}), false);
  assert.equal(bridge.pending.size, 0);
  bridge.dispose();
});
