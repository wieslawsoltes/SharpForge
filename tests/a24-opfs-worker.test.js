import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpfsSyncWorkerHandler, OpfsWorkerClient, OriginPrivateFileSystemProvider, hashFileBytes} from '@sharpforge/workspace';
import {TestDirectoryHandle} from './support/a24-fsa.js';

const encode = value => new TextEncoder().encode(value);

test('A24 OPFS sync-worker preserves exact bytes through reload and reports quota', async () => {
  const root = new TestDirectoryHandle();
  const directory = await root.getDirectoryHandle('Workspace', {create: true});
  const service = createOpfsSyncWorkerHandler({getDirectory: async () => root, chunkBytes: 3});
  const original = Uint8Array.of(255, 254, 0, 13, 10, 0, 128, 1);
  const saved = await service('writeFile', {path: 'file.bin', rootPath: ['Workspace'], bytes: original, expectedHash: null});
  assert.equal(saved.hash, await hashFileBytes(original));
  const loaded = await service('readFile', {path: 'file.bin', rootPath: ['Workspace']});
  assert.deepEqual(loaded.bytes, original);
  assert(directory.children.get('file.bin').syncReads > 0);
  assert.equal([...directory.children.keys()].filter(name => name.startsWith('.sharpforge-opfs')).length, 0);
  const reloaded = new OriginPrivateFileSystemProvider(directory, {storage: {
    estimate: async () => ({usage: 100, quota: 500}), persisted: async () => true
  }});
  assert.deepEqual(await reloaded.readFile('file.bin'), original);
  assert.deepEqual(await reloaded.quota(), {usage: 100, quota: 500, available: 400, persistent: true});
  await assert.rejects(service('writeFile', {path: 'file.bin', rootPath: ['Workspace'], bytes: encode('bad'), expectedHash: null}),
    error => error.code === 'Conflict');
});

test('A24 OPFS cancellation removes staging data and leaves saved bytes unchanged', async () => {
  const root = new TestDirectoryHandle();
  await root.put('file.bin', encode('original'));
  const service = createOpfsSyncWorkerHandler({getDirectory: async () => root, chunkBytes: 2});
  const controller = new AbortController();
  const pending = service('writeFile', {path: 'file.bin', bytes: new Uint8Array(100)}, {signal: controller.signal});
  setTimeout(() => controller.abort(), 1);
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(new TextDecoder().decode(root.children.get('file.bin').bytes), 'original');
  assert.deepEqual([...root.children.keys()], ['file.bin']);
});

test('A24 worker client routes IDs and waits for cancellation acknowledgement', async () => {
  const listeners = new Map();
  const messages = [];
  let terminated = false;
  const worker = {addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type), postMessage: message => messages.push(message), terminate: () => { terminated = true; }};
  const client = new OpfsWorkerClient(worker);
  const controller = new AbortController();
  const pending = client.request('writeFile', {path: 'file.bin'}, {signal: controller.signal});
  controller.abort();
  assert.equal(messages[1].method, 'cancel');
  listeners.get('message')({data: {id: messages[0].id, error: {code: 'Cancelled', path: 'file.bin', message: 'Cancelled'}}});
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(client.pending.size, 0);
  client.dispose();
  assert.equal(terminated, true);
  await assert.rejects(client.request('readFile', {path: 'a'}), error => error.code === 'Disposed');
});

test('A24 browser storage absence is an explicit unavailable diagnostic', async () => {
  await assert.rejects(OriginPrivateFileSystemProvider.open({storage: {}}), error => error.code === 'Unavailable');
  await assert.rejects(new OriginPrivateFileSystemProvider(new TestDirectoryHandle(), {storage: {}}).quota(),
    error => error.code === 'Unavailable');
});
