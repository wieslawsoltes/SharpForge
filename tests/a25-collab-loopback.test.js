import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollabRoomServer } from '../packages/git/src/collab/room-server.js';
import { CollabSession } from '../packages/git/src/collab/session.js';
import { WebSocketCollabTransport } from '../packages/git/src/collab/websocket-transport.js';
import { MemoryCollaborationPersistence } from '../packages/git/src/collab/persistence.js';
import { attachCollaborationWebSocketServer, FileCollaborationJournal } from '../packages/git/collab-server/index.js';
import { CollaborationWebSocket } from '../packages/git/collab-server/websocket-frames.js';
import { identity, document, authorize, tokenFor, waitFor, settle, deferred } from './helpers/a25-collab.js';

test('actual Node WebSockets merge offline edits after server restart and keep wrong-room clients empty', { timeout: 15000 }, async context => {
  assert.equal(typeof globalThis.WebSocket, 'function', 'Node 22 or later is required for native WebSocket qualification');
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-collab-'));
  const persistence = new FileCollaborationJournal({ directory });
  let service = await startService(persistence);
  const url = service.url;
  const journal = new MemoryCollaborationPersistence();
  let first = nativeSession(url, 'first', { persistence: journal });
  const second = nativeSession(url, 'second');
  const denied = nativeSession(url, 'denied', { tokenProvider: () => 'wrong-room-token' });
  context.after(async () => {
    await Promise.all([first.dispose(), second.dispose(), denied.dispose()]);
    await service.dispose();
    journal.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await Promise.all([first.start(), second.start(), denied.start()]);
  await waitFor(() => first.status.synchronized && second.status.synchronized && denied.transport.state === 'blocked');
  await first.replace(0, 0, 'abc');
  await waitFor(() => second.document.text === 'abc' && !first.status.pending);
  assert.equal(denied.document.text, '');
  assert.deepEqual(denied.presence.peers, []);
  await service.dispose();
  await waitFor(() => !first.status.connected && !second.status.connected);
  await first.replace(1, 0, '!');
  await second.replace(3, 0, '?');
  await first.dispose();
  first = nativeSession(url, 'first', { persistence: journal });
  await first.start();
  assert.equal(first.document.text, 'a!bc');
  assert.equal(first.status.pending, 1);
  service = await startService(persistence, Number(new URL(url).port));
  first.transport.reconnect();
  second.transport.reconnect();
  await waitFor(() => first.document.text === 'a!bc?' && second.document.text === first.document.text
    && !first.status.pending && !second.status.pending, 'Native reconnect did not converge', 5000);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  const contents = await readFile(join(directory, files[0]), 'utf8');
  assert(!contents.includes('test-only:'));
  assert.equal((await persistence.load(identity('reader'))).updates.length, 3);
  assert.equal(await persistence.load(identity('reader', { roomId: 'another-room' })), null);
});

test('native WebSocket framing carries a large Unicode operation without splitting UTF-16 semantics', { timeout: 15000 }, async context => {
  const service = await startService();
  const first = nativeSession(service.url, 'first');
  const second = nativeSession(service.url, 'second');
  context.after(async () => { await first.dispose(); await second.dispose(); await service.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.status.synchronized && second.status.synchronized);
  const text = '😀abcdef'.repeat(1000);
  await first.replace(0, 0, text);
  await waitFor(() => second.document.text === text && !first.status.pending, 'Large native frame was not delivered', 5000);
  assert.equal(second.document.toSourceText().text, text);
});

test('reference journal detects damaged persisted history and never treats it as a fresh empty room', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-collab-corrupt-'));
  try {
    const persistence = new FileCollaborationJournal({ directory });
    await persistence.append(identity('writer'), document('writer').insert(0, 'durable'));
    const [file] = await readdir(directory);
    await writeFile(join(directory, file), '{"incomplete":');
    await assert.rejects(persistence.load(identity('writer')), error => error.code === 'Corrupt');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('RFC6455 framing reassembles fragmented UTF-8 around control frames and rejects unmasked clients', async () => {
  const socket = new FixtureSocket();
  const received = [];
  const peer = new CollaborationWebSocket(socket, { maximumBytes: 1024, context: {} });
  peer.bind({ receive: bytes => { received.push(Buffer.from(bytes)); }, close() {} });
  const bytes = Buffer.from('A😀B', 'utf8');
  peer.feed(clientFrame(bytes.subarray(0, 3), 1, false));
  peer.feed(clientFrame(Buffer.from('ping'), 9, true));
  peer.feed(clientFrame(bytes.subarray(3), 0, true));
  await settle();
  assert.deepEqual(received, [bytes]);
  assert.equal(socket.writes[0][0] & 15, 10);
  assert.equal(socket.paused, false);
  const unmasked = Buffer.from([0x81, 1, 65]);
  peer.feed(unmasked);
  assert.equal(socket.writes.at(-1).readUInt16BE(2), 1002);
  assert.equal(socket.ended, true);
  socket.destroy();
});

test('frame length and fragment limits close the connection before delivering partial content', () => {
  const socket = new FixtureSocket();
  let deliveries = 0;
  const peer = new CollaborationWebSocket(socket, { maximumBytes: 8, context: {} });
  peer.bind({ receive: () => { deliveries++; }, close() {} });
  peer.feed(clientFrame(Buffer.from('12345678'), 1, false));
  peer.feed(clientFrame(Buffer.from('9'), 0, true));
  assert.equal(deliveries, 0);
  assert.equal(socket.writes.at(-1).readUInt16BE(2), 1009);
  socket.destroy();
});

test('closing during asynchronous message handling resumes reads so the peer close can release its socket', async () => {
  const socket = new FixtureSocket();
  const pending = deferred();
  const peer = new CollaborationWebSocket(socket, { maximumBytes: 1024, context: {} });
  peer.bind({ receive: () => pending.promise, close() {} });
  try {
    peer.feed(clientFrame(Buffer.from('{}'), 1, true));
    assert.equal(socket.paused, true);
    peer.close(1008, 'Authorization rejected');
    assert.equal(socket.paused, false, 'A terminal reply must not leave a paused readable stream');
    assert.equal(socket.ended, true);
    assert.equal(socket.writes.at(-1).readUInt16BE(2), 1008);
    pending.resolve();
    await settle();
    assert.equal(socket.paused, false);
  } finally { pending.resolve(); socket.destroy(); }
});

async function startService(persistence = null, port = 0) {
  const server = createServer((request, response) => { response.writeHead(404); response.end(); });
  const authority = new CollabRoomServer({ authorize, persistence });
  const adapter = attachCollaborationWebSocketServer(server, { authority, allowMissingOrigin: true });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  let disposed = false;
  return {
    url: 'ws://127.0.0.1:' + server.address().port + '/collab',
    async dispose() {
      if (disposed) return;
      disposed = true;
      adapter.dispose();
      await authority.dispose();
      await new Promise(resolve => server.close(resolve));
    }
  };
}

function nativeSession(url, clientId, options = {}) {
  const value = identity(clientId);
  const transport = new WebSocketCollabTransport({
    identity: value, url, allowInsecureLoopback: true,
    tokenProvider: options.tokenProvider ?? (() => tokenFor(value)), assertOrigin: candidate => assert.equal(candidate, url),
    heartbeatMs: 0, retryMinimumMs: 50, retryMaximumMs: 200, random: () => 0.5
  });
  return new CollabSession({ ...options, document: document(clientId), transport, identity: value, ownDocument: true, presenceHeartbeatMs: 0 });
}

class FixtureSocket extends EventEmitter {
  writes = [];
  destroyed = false;
  paused = false;
  ended = false;
  setTimeout() {}
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  write(bytes) { this.writes.push(Buffer.from(bytes)); return true; }
  end(bytes) { this.write(bytes); this.ended = true; }
  destroy() { this.destroyed = true; this.emit('close'); }
}

function clientFrame(payload, opcode, final) {
  assert(payload.length < 126);
  const result = Buffer.alloc(6 + payload.length);
  result[0] = (final ? 0x80 : 0) | opcode;
  result[1] = 0x80 | payload.length;
  const mask = [11, 22, 33, 44];
  result.set(mask, 2);
  for (let index = 0; index < payload.length; index++) result[6 + index] = payload[index] ^ mask[index & 3];
  return result;
}
