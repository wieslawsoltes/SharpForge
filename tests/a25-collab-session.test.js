import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabSession } from '../packages/git/src/collab/session.js';
import { CollabRoomServer } from '../packages/git/src/collab/room-server.js';
import { WebSocketCollabTransport } from '../packages/git/src/collab/websocket-transport.js';
import { MemoryCollaborationPersistence } from '../packages/git/src/collab/persistence.js';
import { GitError } from '../packages/git/src/errors.js';
import { createCollaborationEditorBinding } from '../apps/studio/git-collab-binding.js';
import { identity, document, authorize, tokenFor, socketConstructor, waitFor, settle, ManualClock, deferred } from './helpers/a25-collab.js';

function session(Socket, clientId, options = {}) {
  const value = identity(clientId);
  const transport = new WebSocketCollabTransport({
    identity: value, url: 'wss://collaboration.example.test/collab', WebSocket: Socket,
    tokenProvider: () => tokenFor(value), assertOrigin: options.assertOrigin ?? (() => undefined),
    heartbeatMs: 0, clock: options.clock
  });
  return new CollabSession({
    ...options, document: document(clientId), transport, identity: value, ownDocument: true, presenceHeartbeatMs: 0
  });
}

test('offline concurrent edits persist in the outbox, restore into a new session and merge after reconnect', async context => {
  const clock = new ManualClock();
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const journal = new MemoryCollaborationPersistence();
  const first = session(Socket, 'first');
  let online = true;
  const options = { persistence: journal, clock, assertOrigin: () => {
    if (!online) throw new GitError('Network', 'Offline fixture');
  } };
  let second = session(Socket, 'second', options);
  context.after(async () => { await first.dispose(); await second.dispose(); journal.dispose(); await server.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.status.synchronized && second.status.synchronized);
  await first.replace(0, 0, 'abc');
  await waitFor(() => second.document.text === 'abc' && !first.status.pending);
  online = false;
  Socket.instances.find(socket => JSON.parse(socket.sent[0]).identity.clientId === 'second').cut();
  await second.replace(1, 0, '!');
  await first.replace(3, 0, 'A');
  assert.equal(second.status.pending, 1);
  assert.equal(second.status.unsaved, 0);
  assert.equal(second.status.persistent, false);
  await second.dispose();
  second = session(Socket, 'second', options);
  await second.start();
  assert.equal(second.document.text, 'a!bc');
  assert.equal(second.status.pending, 1);
  online = true;
  second.transport.reconnect();
  await waitFor(() => first.document.text === 'a!bcA' && second.document.text === first.document.text && !second.status.pending);
  assert.deepEqual((await journal.load(identity('second'))).pendingIds, []);
});

test('room creation preserves an existing editor, competing seeds cannot duplicate it and creator intent survives reload', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const first = session(Socket, 'first', { initializeText: 'existing source' });
  const journal = new MemoryCollaborationPersistence();
  let second = session(Socket, 'second', { initializeText: 'different source', persistence: journal });
  const refusals = [];
  const observeRefusal = value => value.subscribe(event => { if (event.type === 'error') refusals.push(event.error.code); });
  observeRefusal(second);
  const host = editorHost('existing source');
  const binding = createCollaborationEditorBinding(host, first);
  context.after(async () => { binding.dispose(); await first.dispose(); await second.dispose(); journal.dispose(); await server.dispose(); });
  await first.start();
  await waitFor(() => first.status.synchronized && !first.status.pending);
  assert.equal(host.getText(), 'existing source');
  await second.start();
  await waitFor(() => second.transport.state === 'blocked');
  assert.deepEqual(refusals, ['Conflict'], 'A typed room refusal must not become a retryable network failure');
  assert.equal(second.document.text, 'different source');
  assert.equal(second.status.pending, 1);
  assert.equal(first.document.text, 'existing source');
  await second.dispose();
  second = session(Socket, 'second', { persistence: journal });
  observeRefusal(second);
  await second.start();
  await waitFor(() => second.transport.state === 'blocked');
  assert.deepEqual(refusals, ['Conflict', 'Conflict']);
  assert.equal(second.document.text, 'different source');
  assert(Socket.instances.at(-1).sent.some(frame => JSON.parse(frame).type === 'initialize'));
  assert(!Socket.instances.at(-1).sent.some(frame => JSON.parse(frame).type === 'update'));
});

test('local quota errors leave edits visibly unsaved and unsent until persistence is retried', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const storage = new MemoryCollaborationPersistence();
  let full = true;
  const persistence = {
    capability: storage.capability, load: value => storage.load(value),
    append: (...args) => { if (full) throw new GitError('Quota', 'Local journal is full'); return storage.append(...args); },
    appendMany: (...args) => storage.appendMany(...args), acknowledge: (...args) => storage.acknowledge(...args)
  };
  const first = session(Socket, 'first', { persistence });
  const second = session(Socket, 'second');
  const errors = [];
  first.subscribe(event => { if (event.type === 'error') errors.push(event.error.code); });
  context.after(async () => { await first.dispose(); await second.dispose(); storage.dispose(); await server.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.status.synchronized && second.status.synchronized);
  await assert.rejects(first.replace(0, 0, 'unsaved'), error => error.code === 'Quota');
  assert.equal(first.document.text, 'unsaved');
  assert.equal(first.status.unsaved, 1);
  assert.equal(second.document.text, '');
  assert(errors.includes('Quota'));
  full = false;
  await first.retryPendingPersistence();
  await waitFor(() => second.document.text === 'unsaved' && !first.status.pending);
  assert.equal(first.status.unsaved, 0);
});


test('an unsaved initial document cannot bypass the durable outbox through the room seed protocol', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const storage = new MemoryCollaborationPersistence();
  let full = true;
  const persistence = {
    capability: storage.capability, load: value => storage.load(value),
    append: (...args) => { if (full) throw new GitError('Quota', 'Seed journal full'); return storage.append(...args); },
    appendMany: (...args) => storage.appendMany(...args), acknowledge: (...args) => storage.acknowledge(...args)
  };
  const creator = session(Socket, 'creator', { persistence, initializeText: 'existing code' });
  const reader = session(Socket, 'reader');
  context.after(async () => { await creator.dispose(); await reader.dispose(); storage.dispose(); await server.dispose(); });
  await Promise.all([creator.start(), reader.start()]);
  await waitFor(() => reader.status.synchronized && creator.status.connected);
  assert.equal(creator.status.unsaved, 1);
  assert.equal(reader.document.text, '');
  const socket = Socket.instances.find(value => JSON.parse(value.sent[0]).identity.clientId === 'creator');
  assert(!socket.sent.some(frame => JSON.parse(frame).type === 'initialize'));
  full = false;
  await creator.retryPendingPersistence();
  await waitFor(() => reader.document.text === 'existing code' && creator.status.synchronized && !creator.status.pending);
});

test('incoming journal failures remain visible until a successful durable resynchronization', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const storage = new MemoryCollaborationPersistence();
  let full = true;
  const persistence = {
    capability: storage.capability, load: value => storage.load(value),
    append: (...args) => { if (full) throw new GitError('Quota', 'Incoming journal full'); return storage.append(...args); },
    appendMany: (...args) => storage.appendMany(...args), acknowledge: (...args) => storage.acknowledge(...args)
  };
  const writer = session(Socket, 'writer');
  const reader = session(Socket, 'reader', { persistence });
  context.after(async () => { await writer.dispose(); await reader.dispose(); storage.dispose(); await server.dispose(); });
  await Promise.all([writer.start(), reader.start()]);
  await waitFor(() => writer.status.synchronized && reader.status.synchronized);
  await writer.replace(0, 0, 'shared text');
  await waitFor(() => reader.document.text === 'shared text' && reader.status.storageError);
  assert.equal((await storage.load(identity('reader'))).snapshot.updates.length, 0);
  full = false;
  await reader.retryPendingPersistence();
  await waitFor(() => reader.status.synchronized && !reader.status.storageError);
  assert.equal((await storage.load(identity('reader'))).snapshot.updates.length, 1);
});


test('editor host hooks suppress programmatic echo, preserve selections and release every subscription', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const first = session(Socket, 'first', { initializeText: 'abcd' });
  const second = session(Socket, 'second');
  const host = editorHost('abcd');
  const binding = createCollaborationEditorBinding(host, first);
  context.after(async () => { binding.dispose(); await first.dispose(); await second.dispose(); await server.dispose(); });
  await Promise.all([first.start(), second.start()]);
  await waitFor(() => first.status.synchronized && second.document.text === 'abcd');
  host.select({ anchor: 2, focus: 2 });
  await second.replace(0, 0, '!');
  await waitFor(() => host.getText() === '!abcd');
  assert.deepEqual(host.getSelection(), { anchor: 3, focus: 3 });
  assert.equal(first.document.updatesByActor().length, 1);
  host.edit({ start: 5, deleteCount: 0, insertText: '?' });
  await waitFor(() => second.document.text === '!abcd?');
  binding.dispose();
  assert.equal(host.listenerCount(), 0);
  assert.deepEqual(host.cursors, []);
});

test('disposal waits for an accepted local persistence transaction and rejects later edits', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const pending = deferred();
  const storage = new MemoryCollaborationPersistence();
  const persistence = {
    capability: storage.capability, load: value => storage.load(value),
    append: async (...args) => { await pending.promise; await storage.append(...args); },
    appendMany: (...args) => storage.appendMany(...args), acknowledge: (...args) => storage.acknowledge(...args)
  };
  const value = session(Socket, 'owner', { persistence });
  context.after(async () => { await value.dispose(); storage.dispose(); await server.dispose(); });
  await value.start();
  await waitFor(() => value.status.synchronized);
  const saved = value.replace(0, 0, 'closing');
  let closed = false;
  const disposal = value.dispose();
  assert.equal(value.dispose(), disposal, 'concurrent callers await the same accepted journal transaction');
  const closing = disposal.then(() => { closed = true; });
  await settle();
  assert.equal(closed, false);
  pending.resolve();
  await Promise.all([saved, closing]);
  assert.equal((await storage.load(identity('owner'))).snapshot.updates.length, 1);
  assert.throws(() => value.replace(0, 0, 'late'), error => error.code === 'Disposed');
});


function editorHost(initialText) {
  let text = initialText;
  let selection = { anchor: 0, focus: 0 };
  const textListeners = new Set();
  const selectionListeners = new Set();
  const host = {
    cursors: [], getText: () => text, getSelection: () => selection, setSelection: value => { selection = value; },
    onTextChange: listener => { textListeners.add(listener); return () => textListeners.delete(listener); },
    onSelectionChange: listener => { selectionListeners.add(listener); return () => selectionListeners.delete(listener); },
    setRemoteCursors: value => { host.cursors = value; },
    listenerCount: () => textListeners.size + selectionListeners.size,
    select: value => { selection = value; for (const listener of selectionListeners) listener(value); },
    edit: change => {
      text = text.slice(0, change.start) + change.insertText + text.slice(change.start + change.deleteCount);
      for (const listener of textListeners) listener(change);
    }
  };
  host.applyRemoteTextChange = host.edit;
  return host;
}
