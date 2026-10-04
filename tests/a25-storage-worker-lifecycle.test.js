import test from 'node:test';
import assert from 'node:assert/strict';
import { OPFSStore, createBrowserObjectDatabase } from '../packages/git/src/storage/opfs-odb.js';

// These endpoint fault tests do not stand in for the separate native Chromium OPFS acceptance.
class ControlledWorker extends EventTarget {
  messages = [];
  terminated = false;
  failure;
  postMessage(message) {
    if (this.failure) throw this.failure;
    this.messages.push(message);
  }
  terminate() { this.terminated = true; }
  reply(id, result, error) { this.dispatchEvent(new MessageEvent('message', { data: { id, result, error } })); }
}

const capabilities = { backend: 'opfs-sync-worker', persistent: true, atomicTransactions: true };

test('OPFS worker failure rejects active and future requests without leaving deadlines behind', async () => {
  const worker = new ControlledWorker();
  const store = new OPFSStore({ repositoryId: 'failure', workerFactory: () => worker });
  worker.reply(1, capabilities);
  await store.ready;
  const pending = store.get('HEAD');
  await Promise.resolve();
  worker.dispatchEvent(new Event('error'));
  await assert.rejects(pending, { code: 'Unsupported' });
  await assert.rejects(store.get('HEAD'), { code: 'Unsupported' });
  assert.equal(worker.terminated, true);
  await store.close();
});

test('OPFS initialization cancellation closes the worker without waiting for a capability response', async () => {
  const worker = new ControlledWorker();
  const controller = new AbortController();
  const opening = createBrowserObjectDatabase({ repositoryId: 'cancelled-open', workerFactory: () => worker,
    signal: controller.signal });
  controller.abort();
  await assert.rejects(opening, { code: 'Cancelled' });
  assert.equal(worker.terminated, true);
});

test('OPFS endpoint serialization failures and invalid replies reject as typed errors', async () => {
  const worker = new ControlledWorker();
  const store = new OPFSStore({ repositoryId: 'malformed', workerFactory: () => worker });
  worker.reply(1, capabilities);
  await store.ready;
  const malformed = store.get('HEAD');
  await Promise.resolve();
  worker.reply(2, undefined, { code: 'Unknown', message: 'not a valid protocol code' });
  await assert.rejects(malformed, { code: 'Corrupt' });
  worker.failure = new DOMException('Endpoint cannot clone message', 'DataCloneError');
  await assert.rejects(store.get('HEAD'), { code: 'Corrupt' });
  assert.equal(worker.terminated, true);
  await store.close();
});

test('OPFS response deadlines are finite and terminate an unresponsive worker', async () => {
  const worker = new ControlledWorker();
  const store = new OPFSStore({ repositoryId: 'deadline', workerFactory: () => worker, requestTimeoutMs: 5 });
  await assert.rejects(store.ready, { code: 'Network' });
  assert.equal(worker.terminated, true);
  await store.close();
  assert.throws(() => new OPFSStore({ repositoryId: 'bad', workerFactory: () => worker, requestTimeoutMs: Infinity }), { code: 'Limit' });
});
