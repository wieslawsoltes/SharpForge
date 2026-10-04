import test from 'node:test';
import assert from 'node:assert/strict';
import {UIEventTransactions} from '../apps/studio/workers/ui-event-transactions.js';
import {validateUIEventRequest, copyUIEventPayload} from '../apps/studio/workers/ui-event-protocol.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
function timers() {
  const pending = new Map();
  let serial = 0;
  return {pending, schedule: callback => { pending.set(++serial, callback); return serial; },
    cancel: id => pending.delete(id), expire() { for (const callback of [...pending.values()]) callback(); }};
}
const packet = requestId => ({version: 1, sessionId: 7, requestId, id: 'control', event: 'Closing', payload: {Cancel: false}});

test('the decision packet rejects executable members, aliases, invalid identities and input budget overflow', () => {
  const value = packet(1), cloned = validateUIEventRequest(value);
  assert.deepEqual(cloned, value);
  assert.notEqual(cloned.payload, value.payload);
  for (const invalid of [{...value, version: 2}, {...value, sessionId: 0}, {...value, requestId: 0},
    {...value, id: ''}, {...value, event: 'x'.repeat(129)}, {...value, method: 'dispose'}, {...value, payload: []}]) {
    assert.throws(() => validateUIEventRequest(invalid), TypeError);
  }
  assert.throws(() => copyUIEventPayload({GetDeferral() {}}), /unsupported/);
  assert.throws(() => copyUIEventPayload({value: new Date()}), /projection/);
  let read = false;
  assert.throws(() => copyUIEventPayload({get Cancel() { read = true; return true; }}), /member/);
  assert.equal(read, false);
  assert.throws(() => copyUIEventPayload({value: 'x'.repeat(65537)}), /text limit/);
  assert.throws(() => copyUIEventPayload({value: Array(1025).fill(0)}), /collection limit/);
  let deep = {};
  for (let index = 0; index < 13; index++) deep = {child: deep};
  assert.throws(() => copyUIEventPayload(deep), /data limit/);
  assert.deepEqual(validateUIEventRequest({version: 1, sessionId: 7, requestId: 1}, {cancellation: true}),
    {version: 1, sessionId: 7, requestId: 1});
});

test('transactions enforce the 64-request ceiling and release timers on timeout, abort and disposal', async () => {
  const time = timers(), transactions = new UIEventTransactions(time);
  const entries = Array.from({length: 64}, (_, index) => transactions.begin(index + 1));
  const outcomes = entries.map(entry => assert.rejects(entry.promise, {name: 'AbortError'}));
  assert.throws(() => transactions.begin(65), {name: 'QuotaExceededError'});
  assert.throws(() => transactions.begin(1), /duplicate/);
  transactions.dispose();
  await Promise.all(outcomes);
  assert.equal(transactions.pending.size, 0);
  assert.equal(time.pending.size, 0);
  assert.ok(entries.every(entry => entry.controller.signal.aborted));
  assert.throws(() => transactions.begin(66), {name: 'AbortError'});
  const next = new UIEventTransactions(time), entry = next.begin(1);
  const timedOut = assert.rejects(entry.promise, {name: 'TimeoutError'});
  time.expire();
  await timedOut;
  assert.equal(next.resolve(entry, {Cancel: false}), false);
  const controller = new AbortController(), aborted = next.begin(2, {signal: controller.signal});
  const canceled = assert.rejects(aborted.promise, /superseded/);
  controller.abort(new Error('superseded'));
  await canceled;
  assert.equal(time.pending.size, 0);
  next.dispose();
  assert.throws(() => new UIEventTransactions({maximum: 65}), /limits/);
  assert.throws(() => new UIEventTransactions({timeout: 30001}), /limits/);
  const broken = new UIEventTransactions({schedule() { throw new Error('timer unavailable'); }});
  await assert.rejects(broken.begin(1).promise, /timer unavailable/);
  assert.equal(broken.pending.size, 0);
});
