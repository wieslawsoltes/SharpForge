import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerAppWorkerChannel} from '../apps/studio/designer-app-host-channel.js';
import {awaitAppOperation} from '../apps/studio/designer-app-host-errors.js';

class WorkerStub extends EventTarget {
  constructor() { super(); this.sent = []; this.terminated = false; }
  postMessage(value) { this.sent.push(value); }
  terminate() { this.terminated = true; }
  reply(value) { this.dispatchEvent(new MessageEvent('message', {data: value})); }
}

test('worker channels correlate simultaneous requests without sharing pending promises or identities', async () => {
  const firstWorker = new WorkerStub(), secondWorker = new WorkerStub();
  const first = new DesignerAppWorkerChannel(firstWorker), second = new DesignerAppWorkerChannel(secondWorker);
  const before = first.request('state', {sessionId: 17});
  const snapshot = first.request('designSnapshot', {sessionId: 17});
  const other = second.request('state', {sessionId: 17});
  assert.notEqual(before, snapshot);
  assert.deepEqual(firstWorker.sent.map(value => value.id), [1, 2]);
  assert.equal(secondWorker.sent[0].id, 1, 'ids are local to each independent worker');
  secondWorker.reply({id: 1, result: 'other worker'});
  firstWorker.reply({id: 2, result: 'scene'});
  firstWorker.reply({id: 1, result: 'state'});
  assert.deepEqual(await Promise.all([before, snapshot, other]), ['state', 'scene', 'other worker']);
  assert.equal(first.pending.size, 0);
  first.dispose();
  second.dispose();
});

test('cancellation releases pending requests and ignores their eventual replies', async () => {
  const worker = new WorkerStub(), events = [];
  const channel = new DesignerAppWorkerChannel(worker, {onEvent: event => events.push(event)});
  const controller = new AbortController();
  const pending = channel.request('state', {}, {signal: controller.signal});
  controller.abort(new DOMException('Canceled', 'AbortError'));
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(channel.pending.size, 0);
  worker.reply({id: 1, result: 'late'});
  worker.reply({event: 'state', sessionId: 42, state: 'paused'});
  assert.equal(events.length, 1);
  assert.throws(() => channel.request('state', {}, {signal: controller.signal}), {name: 'AbortError'});
  channel.dispose();
  worker.reply({event: 'state', sessionId: 42});
  assert.equal(events.length, 1);
});

test('pending limits, unknown methods, deadlines and worker errors fail explicitly', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const worker = new WorkerStub();
  const channel = new DesignerAppWorkerChannel(worker, {timeout: 100, maxPending: 1});
  const pending = channel.request('pause');
  const timedOut = assert.rejects(pending, {code: 'SFDA0004'});
  await assert.rejects(channel.request('state'), {code: 'SFDA0006'});
  await assert.rejects(channel.request('not-a-runtime-method'), {code: 'SFDA0003'});
  context.mock.timers.tick(100);
  await timedOut;
  assert.equal(channel.pending.size, 0);
  const errorReply = channel.request('resume');
  worker.reply({id: 2, error: {message: 'Paused frame mismatch', code: 'VM-CONFLICT'}});
  await assert.rejects(errorReply, {code: 'VM-CONFLICT', message: 'Paused frame mismatch'});
  channel.dispose();
});

test('fatal worker errors reject every pending request and dispose all listeners', async () => {
  const worker = new WorkerStub(), failures = [];
  const channel = new DesignerAppWorkerChannel(worker, {onFailure: error => failures.push(error)});
  const requests = [channel.request('state'), channel.request('pause')];
  const failuresExpected = requests.map(request => assert.rejects(request, {code: 'SFDA0005'}));
  worker.dispatchEvent(new Event('messageerror'));
  await Promise.all(failuresExpected);
  assert.equal(failures.length, 1);
  assert.equal(channel.pending.size, 0);
  assert.equal(worker.terminated, true);
  worker.dispatchEvent(new Event('error'));
  assert.equal(failures.length, 1);
  await assert.rejects(channel.request('state'), {code: 'SFDA0002'});
});

test('postMessage failures are returned to the caller without leaking a deadline', async () => {
  const worker = new WorkerStub();
  worker.postMessage = () => { throw new DOMException('Invalid clone', 'DataCloneError'); };
  const channel = new DesignerAppWorkerChannel(worker);
  await assert.rejects(channel.request('state'), {name: 'DataCloneError'});
  assert.equal(channel.pending.size, 0);
  channel.dispose();
});

test('compilation deadlines and aborts settle even if a provider does not cooperate', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  const timed = awaitAppOperation(() => new Promise(() => {}), {timeout: 100});
  const expected = assert.rejects(timed, {code: 'SFDA0004'});
  context.mock.timers.tick(100);
  await expected;
  const controller = new AbortController();
  const canceled = awaitAppOperation(() => new Promise(() => {}), {signal: controller.signal});
  controller.abort();
  await assert.rejects(canceled, {name: 'AbortError'});
});
