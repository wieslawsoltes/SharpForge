import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { GitWorkerClient } from '../packages/git/src/worker/client.js';
import { createGitWorkerServer } from '../packages/git/src/worker/server.js';
import { createGitService } from '../packages/git/src/factory.js';

class ControlledEndpoint extends EventTarget {
  messages = [];
  failCancellation = false;
  postMessage(message) {
    if (this.failCancellation && message.type === 'cancel') throw new Error('Endpoint closed');
    this.messages.push(message);
  }
  reply(message) {
    this.dispatchEvent(new MessageEvent('message', { data: { version: 1, session: 'controlled', ...message } }));
  }
}

async function closeControlled(client, endpoint) {
  const closing = client.dispose();
  const request = endpoint.messages.at(-1);
  if (request?.method === 'dispose') endpoint.reply({ type: 'response', id: request.id, result: true });
  await closing;
}

function rawRequest(port, message) {
  return new Promise(resolve => {
    const listener = event => {
      if (event.data.type !== 'response' || event.data.id !== message.id || event.data.session !== message.session) return;
      port.removeEventListener('message', listener);
      resolve(event.data);
    };
    port.addEventListener('message', listener);
    port.postMessage({ version: 1, type: 'request', params: {}, ...message });
  });
}

test('worker endpoint failure rejects present and future client requests', async () => {
  const endpoint = new ControlledEndpoint();
  const client = new GitWorkerClient(endpoint, { session: 'controlled' });
  const pending = client.request('status');
  endpoint.dispatchEvent(new Event('error'));
  await assert.rejects(pending, { code: 'Network' });
  await assert.rejects(client.request('status'), { code: 'Network' });
  assert.equal(endpoint.messages.length, 1);
  await client.dispose();
});

test('cancel and timeout delivery failures cannot strand the request or throw from timer callbacks', async () => {
  const endpoint = new ControlledEndpoint();
  endpoint.failCancellation = true;
  const client = new GitWorkerClient(endpoint, { session: 'controlled' });
  const signal = new AbortController();
  const cancelled = client.request('status', {}, { signal: signal.signal });
  signal.abort();
  await assert.rejects(cancelled, { code: 'Cancelled' });
  await assert.rejects(client.request('status'), { code: 'Network' });
  await client.dispose();
  const timedEndpoint = new ControlledEndpoint();
  timedEndpoint.failCancellation = true;
  const timed = new GitWorkerClient(timedEndpoint, { session: 'controlled' });
  await assert.rejects(timed.request('status', {}, { timeoutMs: 5 }), { code: 'Network' });
  await timed.dispose();
});

test('malformed replies and progress callback failures settle once and ignore late success', async () => {
  const endpoint = new ControlledEndpoint();
  const client = new GitWorkerClient(endpoint, { session: 'controlled' });
  try {
    const malformed = client.request('status');
    endpoint.reply({ type: 'response', id: 1, error: { code: 'Invalid', message: 'bad wire error' } });
    await assert.rejects(malformed, { code: 'Corrupt' });
    const progress = client.request('status', {}, { onProgress() { throw new Error('Observer failed'); } });
    endpoint.reply({ type: 'progress', id: 2, progress: { phase: 'reading' } });
    await assert.rejects(progress, /Observer failed/u);
    let settled = false;
    const next = client.request('status').then(result => { settled = true; return result; });
    endpoint.reply({ type: 'response', id: 2, result: 'stale' });
    await Promise.resolve();
    assert.equal(settled, false);
    endpoint.reply({ type: 'response', id: 3, result: 'current' });
    assert.equal(await next, 'current');
  } finally { await closeControlled(client, endpoint); }
});

test('client disposal blocks new work immediately and has one remote cleanup handshake', async () => {
  const endpoint = new ControlledEndpoint();
  const client = new GitWorkerClient(endpoint, { session: 'controlled' });
  const active = client.request('status');
  const disposal = client.dispose();
  assert.equal(client.dispose(), disposal);
  await assert.rejects(active, { code: 'Cancelled' });
  await assert.rejects(client.request('init'), { code: 'Disposed' });
  assert.equal(endpoint.messages.filter(message => message.method === 'dispose').length, 1);
  endpoint.reply({ type: 'response', id: 2, result: true });
  await disposal;
  assert.equal(client.closed, true);
  await assert.rejects(client.request('status', {}, { timeoutMs: Infinity }), { code: 'Disposed' });
});

test('invalid deadline and identity bounds fail before sending a worker request', async () => {
  const endpoint = new ControlledEndpoint();
  const client = new GitWorkerClient(endpoint, { session: 'controlled' });
  for (const timeoutMs of [0, -1, NaN, Infinity, 2147483648]) {
    await assert.rejects(client.request('status', {}, { timeoutMs }), { code: 'Limit' });
  }
  client.nextId = Number.MAX_SAFE_INTEGER;
  await assert.rejects(client.request('status'), { code: 'Limit' });
  assert.deepEqual(endpoint.messages, []);
  client.nextId = 0;
  await closeControlled(client, endpoint);
});

test('real message ports reject replayed mutations and cannot recreate a retired service session', async () => {
  const { port1, port2 } = new MessageChannel();
  let created = 0;
  const server = createGitWorkerServer({ endpoint: port1, createService: () => { created++; return createGitService(); } });
  const client = new GitWorkerClient(port2, { session: 'native-ports' });
  try {
    await client.request('init');
    await client.request('writeFile', { path: 'file.txt', data: 'original' });
    const replay = await rawRequest(port2, { session: 'native-ports', id: 2, method: 'writeFile',
      params: { path: 'file.txt', data: 'replayed' } });
    assert.equal(replay.error.code, 'Conflict');
    const file = await client.request('readFile', { path: 'file.txt' });
    assert.equal(new TextDecoder().decode(file.data), 'original');
    await client.dispose();
    const late = await rawRequest(port2, { session: 'native-ports', id: 999, method: 'init' });
    assert.equal(late.error.code, 'Disposed');
    const duplicateDispose = await rawRequest(port2, { session: 'native-ports', id: 1000, method: 'dispose' });
    assert.equal(duplicateDispose.result, true);
    assert.equal(created, 1);
  } finally {
    await client.dispose();
    await server.dispose();
    port1.close();
    port2.close();
  }
});

test('disposal during async service creation never starts the queued repository operation', async () => {
  const { port1, port2 } = new MessageChannel();
  let start;
  let release;
  const started = new Promise(resolve => { start = resolve; });
  const ready = new Promise(resolve => { release = resolve; });
  let disposed = 0;
  let operations = 0;
  const server = createGitWorkerServer({ endpoint: port1, createService: async () => {
    start();
    await ready;
    return { request() { operations++; }, dispose() { disposed++; } };
  } });
  const client = new GitWorkerClient(port2, { session: 'opening' });
  let acknowledgeDispose;
  const disposeReceived = new Promise(resolve => { acknowledgeDispose = resolve; });
  const observeDispose = event => {
    const message = event.data;
    if (message.type === 'request' && message.session === 'opening' && message.method === 'dispose') acknowledgeDispose();
  };
  port1.addEventListener('message', observeDispose);
  try {
    const opening = client.request('init');
    await started;
    const disposal = client.dispose();
    await assert.rejects(opening, { code: 'Cancelled' });
    // Local cancellation settles before delivery; the remote listener must begin closing the pending factory first.
    await disposeReceived;
    release();
    await disposal;
    assert.equal(operations, 0);
    assert.equal(disposed, 1);
  } finally {
    release();
    port1.removeEventListener('message', observeDispose);
    await client.dispose();
    await server.dispose();
    port1.close();
    port2.close();
  }
});

test('bounded retired-session history refuses growth without allocating a new service', async () => {
  const { port1, port2 } = new MessageChannel();
  let created = 0;
  const server = createGitWorkerServer({ endpoint: port1, maxSessions: 1, maxSessionHistory: 2,
    createService: () => { created++; return createGitService(); } });
  try {
    await new GitWorkerClient(port2, { session: 'first' }).dispose();
    await new GitWorkerClient(port2, { session: 'second' }).dispose();
    const response = await rawRequest(port2, { session: 'third', id: 1, method: 'init' });
    assert.equal(response.error.code, 'Limit');
    assert.equal(created, 0);
  } finally { await server.dispose(); port1.close(); port2.close(); }
});
