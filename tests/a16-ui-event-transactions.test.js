import test from 'node:test';
import assert from 'node:assert/strict';
import {UIEventTransactions} from '../apps/studio/workers/ui-event-transactions.js';
import {validateUIEventRequest, copyUIEventPayload} from '../apps/studio/workers/ui-event-protocol.js';
import {StudioUIEventClient} from '../apps/studio/ui-event-client.js';
import {RuntimeUIEventRequests, registerRuntimeEventRequests} from '../apps/studio/workers/ui-event-runtime.js';
import {createWorkerProtocol} from '../apps/studio/workers/protocol.js';

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

test('the host client awaits one RPC and rejects stale or superseded replies without dispatching a duplicate event', async () => {
  const time = timers(), calls = [], sent = [], responses = [];
  const bridge = {sessionId: 7, nextEventRequest: 1, paused: false, closed: false, host: {nodes: new Map([['control', {}]])},
    request(method, params) { const response = deferred(); calls.push({method, params}); responses.push(response); return response.promise; },
    send: (method, params, session) => sent.push({method, params, session})};
  const client = new StudioUIEventClient(bridge, time);
  const first = client.request('control', 'Closing', {Cancel: false});
  assert.equal(calls[0].method, 'uiEventRequest');
  assert.deepEqual(calls[0].params, packet(1));
  responses[0].resolve({Cancel: true});
  assert.deepEqual(await first, {Cancel: true});
  assert.equal(sent.length, 0);
  const controller = new AbortController();
  const second = client.request('control', 'Closing', {}, {signal: controller.signal});
  const canceled = assert.rejects(second, /superseded/);
  controller.abort(new Error('superseded'));
  await canceled;
  responses[1].resolve({Cancel: false});
  await Promise.resolve();
  assert.equal(sent[0].method, 'uiEventCancel');
  assert.equal(sent[0].params.requestId, 2);
  const third = client.request('control', 'Closing');
  const stale = assert.rejects(third, /session changed/);
  bridge.sessionId = 8;
  responses[2].resolve({Cancel: false});
  await stale;
  assert.equal(client.transactions.pending.size, 0);
  bridge.paused = true;
  await assert.rejects(client.request('control', 'Closing'), /Continue execution/);
  bridge.paused = false;
  bridge.host.nodes.clear();
  await assert.rejects(client.request('control', 'Closing'), /removed/);
  client.dispose();
  assert.equal(time.pending.size, 0);
});

test('runtime requests propagate cancellation into managed deferrals and reject replay, paused sessions and late outcomes', async () => {
  const time = timers(), requested = [];
  const bridge = {sessionId: 7, closed: false, vm: {state: 'terminated', platform: {ui: {
    reference: id => ({id}), requestEvent(receiver, event, payload, options) {
      const result = deferred(); requested.push({receiver, event, payload, options, result}); return result.promise;
    }
  }}}};
  const requests = new RuntimeUIEventRequests(bridge, time);
  bridge.eventRequests = requests;
  const handlers = createWorkerProtocol('runtime');
  let flushes = 0, schedules = 0, interactive = 0;
  registerRuntimeEventRequests(handlers, {current: () => ({bridge}), interactive: () => { interactive++; },
    flush: () => { flushes++; }, schedule: () => { schedules++; }});
  const first = handlers.dispatch('uiEventRequest', packet(1));
  assert.equal(interactive, 1);
  assert.equal(flushes, 1);
  assert.equal(schedules, 1);
  requested[0].result.resolve({Cancel: true});
  assert.deepEqual(await first, {Cancel: true});
  assert.equal(flushes, 2);
  await assert.rejects(requests.request(packet(1)), /already used/);
  const second = handlers.dispatch('uiEventRequest', packet(2));
  const canceled = assert.rejects(second, {name: 'AbortError'});
  assert.equal(handlers.dispatch('uiEventCancel', {version: 1, sessionId: 7, requestId: 2}), true);
  await canceled;
  assert.equal(requested[1].options.signal.aborted, true);
  requested[1].result.resolve({Cancel: false});
  await Promise.resolve();
  assert.equal(requests.transactions.pending.size, 0);
  assert.equal(requests.cancel({version: 1, sessionId: 6, requestId: 3}), false);
  const third = requests.request(packet(3));
  const paused = assert.rejects(third, /paused or ended/);
  bridge.vm.state = 'paused';
  requests.observe();
  await paused;
  await assert.rejects(requests.request(packet(4)), /Continue execution/);
  bridge.vm.state = 'terminated';
  const fourth = requests.request(packet(4));
  const disposed = assert.rejects(fourth, {name: 'AbortError'});
  requests.dispose();
  await disposed;
  assert.equal(time.pending.size, 0);
  assert.equal(requested[3].options.signal.aborted, true);
  handlers.dispose();
});
