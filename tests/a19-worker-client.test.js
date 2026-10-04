import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerClient } from '../apps/studio/workbench/worker-client.js';
import { WorkbenchEvents } from '../apps/studio/workbench/state-events.js';
import { fakeWorkers } from './a19-session-fixtures.js';

test('worker requests preserve the protocol and reject errors without leaking pending requests', async () => {
  const fake = fakeWorkers();
  const client = new WorkerClient('compiler.worker.js', { workerFactory: fake.factory, kind: 'compiler' });
  const request = client.request('build', { revision: 9 });
  assert.deepEqual(fake.workers[0].requests[0], { id: 1, method: 'build', params: { revision: 9 } });
  fake.workers[0].reply(1, null, Object.assign(new Error('Invalid source'), { code: 'SF1001' }));
  await assert.rejects(request, { message: 'Invalid source', code: 'SF1001' });
  assert.equal(client.pending.size, 0);
  await assert.rejects(client.request('unknown'), { code: 'UNKNOWN_METHOD' });
  client.dispose();
});

test('worker errors reject all requests and only explicit restart admits new work', async () => {
  const fake = fakeWorkers();
  const errors = [];
  const client = new WorkerClient('runtime.worker.js', { workerFactory: fake.factory, onError: error => errors.push(error) });
  const first = client.request('one');
  const second = client.request('two');
  fake.workers[0].onerror({ message: 'Worker crashed' });
  await Promise.all([assert.rejects(first, { code: 'WORKER_FAILED' }), assert.rejects(second, { code: 'WORKER_FAILED' })]);
  assert.equal(errors.length, 1);
  await assert.rejects(client.request('three'), { code: 'WORKER_FAILED' });
  client.restart();
  const next = client.request('three');
  fake.workers[1].reply(3, 42);
  assert.equal(await next, 42);
  assert.equal(fake.workers[0].terminated, true);
  client.dispose();
});

test('restart generations suppress late replies and events from the terminated worker', async () => {
  const fake = fakeWorkers();
  const events = [];
  const client = new WorkerClient('runtime.worker.js', { workerFactory: fake.factory, onEvent: event => events.push(event) });
  const old = client.request('state');
  client.restart();
  await assert.rejects(old, { code: 'WORKER_RESTARTED' });
  fake.workers[0].emit({ event: 'output', text: 'stale', sessionId: 99 });
  const current = client.request('state');
  fake.workers[0].reply(2, 'stale');
  assert.equal(client.pending.size, 1);
  fake.workers[1].reply(2, 'current');
  assert.equal(await current, 'current');
  assert.deepEqual(events, []);
  client.dispose();
});

test('timeout, abort, quota and disposal all clean up their pending requests', async () => {
  const fake = fakeWorkers();
  const client = new WorkerClient('worker.js', { workerFactory: fake.factory, timeoutMs: 10, maxPending: 1 });
  const timed = client.request('slow');
  await assert.rejects(client.request('overflow'), { code: 'WORKER_QUOTA' });
  await assert.rejects(timed, { code: 'WORKER_TIMEOUT' });
  const controller = new AbortController();
  const aborted = client.request('cancelled', {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, { name: 'AbortError' });
  assert.equal(client.pending.size, 0);
  const pending = client.request('disposed');
  client.dispose();
  await assert.rejects(pending, { code: 'WORKER_DISPOSED' });
  assert.equal(client.pending.size, 0);
});

test('constructor request middleware is explicit and preserves input objects', async () => {
  const fake = fakeWorkers();
  const client = new WorkerClient('runtime.worker.js', {
    workerFactory: fake.factory,
    transformRequest: (method, params) => ({ ...params, sessionId: 3 })
  });
  const params = { expression: 'x' };
  const request = client.request('evaluate', params);
  assert.deepEqual(fake.workers[0].requests[0].params, { expression: 'x', sessionId: 3 });
  assert.deepEqual(params, { expression: 'x' });
  fake.workers[0].reply(1, { result: 10 });
  assert.deepEqual(await request, { result: 10 });
  client.dispose();
});

test('event delivery is ordered under reentrancy and unsubscribe during dispatch', () => {
  const events = new WorkbenchEvents();
  const seen = [];
  let remove;
  events.subscribe(event => {
    seen.push(`first:${event.type}`);
    if (event.type === 'a') { remove(); events.emit({ type: 'b' }); }
  });
  remove = events.subscribe(event => seen.push(`second:${event.type}`));
  events.emit({ type: 'a' });
  assert.deepEqual(seen, ['first:a', 'first:b']);
  events.dispose();
});
