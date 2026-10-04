import test from 'node:test';
import assert from 'node:assert/strict';
import { HostEventRequests } from '../packages/winui-controls/src/host/event-requests.js';

function fixture(onEventRequest, options) {
  const emitted = [];
  const host = { nodes: new Map([['control', { id: 'control' }]]), options: { onEventRequest },
    emit: (...args) => emitted.push(args) };
  return { requests: new HostEventRequests(host, options), emitted, host };
}

test('local cancellable events and asynchronous outcome acknowledgements preserve data fields', async () => {
  const local = fixture();
  assert.deepEqual(await local.requests.request('control', 'Closing', { Cancel: false }), { Cancel: false });
  assert.equal(local.emitted.length, 1);
  const remote = fixture(async (id, event, payload) => ({ ...payload, Cancel: true, Handled: true }));
  assert.deepEqual(await remote.requests.request('control', 'Closing', { Cancel: false }), { Cancel: true, Handled: true });
  assert.equal(remote.emitted.length, 0);
  assert.equal(remote.requests.pending.size, 0);
});

test('event requests abort on caller cancellation, node removal and host disposal', async () => {
  const observed = [];
  const { requests } = fixture((id, event, payload, { signal }) => {
    observed.push(signal);
    return new Promise(() => {});
  });
  const controller = new AbortController();
  const first = requests.request('control', 'BeforeTextChanging', { NewText: 'next', Cancel: false }, { signal: controller.signal });
  const canceled = assert.rejects(first, { name: 'AbortError' });
  controller.abort();
  await canceled;
  assert.equal(observed[0].aborted, true);
  const second = requests.request('control', 'Closing', {});
  const removed = assert.rejects(second, /target was removed/);
  requests.cancelTarget('control');
  await removed;
  const third = requests.request('control', 'RefreshRequested', {});
  const disposed = assert.rejects(third, /root was reset/);
  requests.dispose();
  await disposed;
  assert.equal(requests.pending.size, 0);
  await assert.rejects(requests.request('control', 'Closing', {}), { name: 'AbortError' });
});

test('event acknowledgement bounds reject unsupported objects, targets and excess pending work', async () => {
  const { requests } = fixture(() => new Promise(() => {}), { maximumPending: 1 });
  await assert.rejects(requests.request('missing', 'Closing', {}), /Invalid UI event request/);
  await assert.rejects(requests.request('control', 'Closing', { file: new Date() }), /explicit routed-event projection/);
  const pending = requests.request('control', 'Closing', {});
  const disposed = assert.rejects(pending, /root was reset/);
  await assert.rejects(requests.request('control', 'Closing', {}), /Pending UI event request limit/);
  requests.dispose();
  await disposed;
});
