import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketCollabTransport } from '../packages/git/src/collab/websocket-transport.js';
import { CollabRoomServer } from '../packages/git/src/collab/room-server.js';
import { collaborationMessage } from '../packages/git/src/collab/protocol.js';
import { GitError } from '../packages/git/src/errors.js';
import { identity, authorize, tokenFor, deferred, settle, waitFor, socketConstructor, ManualClock } from './helpers/a25-collab.js';

function transportOptions(value, Socket, overrides = {}) {
  return {
    identity: value, url: 'wss://collaboration.example.test/collab', WebSocket: Socket,
    tokenProvider: () => tokenFor(value), assertOrigin: () => undefined, heartbeatMs: 0, ...overrides
  };
}

test('WebSocket checks the exact origin before credentials and sends the token only in its first frame', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const value = identity('client');
  const calls = [];
  const transport = new WebSocketCollabTransport(transportOptions(value, Socket, {
    assertOrigin: url => { calls.push(['grant', url]); },
    tokenProvider: () => { calls.push(['token']); return tokenFor(value); }
  }));
  context.after(async () => { transport.dispose(); await server.dispose(); });
  transport.start();
  await waitFor(() => transport.connected);
  transport.send(collaborationMessage('sync-request'));
  await settle();
  assert.deepEqual(calls.map(call => call[0]), ['grant', 'token']);
  assert.equal(calls[0][1], 'wss://collaboration.example.test/collab');
  const socket = Socket.instances[0];
  assert(!socket.url.includes(tokenFor(value)));
  assert.equal(JSON.parse(socket.sent[0]).token, tokenFor(value));
  assert(!socket.sent.slice(1).some(frame => frame.includes('test-only:')));
});

test('wrong tokens and revoked origins fail closed, without retry or disclosure', async context => {
  const server = new CollabRoomServer({ authorize });
  context.after(() => server.dispose());
  const Socket = socketConstructor(server);
  const denied = new WebSocketCollabTransport(transportOptions(identity('denied'), Socket, { tokenProvider: () => 'wrong-room' }));
  context.after(() => denied.dispose());
  const events = [];
  denied.subscribe(event => events.push(event));
  denied.start();
  await waitFor(() => denied.state === 'blocked');
  assert(!events.some(event => event.type === 'open' || event.type === 'message'));
  assert(events.some(event => event.type === 'error' && event.error.code === 'Auth' && !event.retrying));
  let credentials = 0;
  const revoked = new WebSocketCollabTransport(transportOptions(identity('revoked'), Socket, {
    assertOrigin: () => { throw new GitError('Unsafe', 'Grant revoked'); }, tokenProvider: () => { credentials++; return 'unused'; }
  }));
  context.after(() => revoked.dispose());
  revoked.start();
  await waitFor(() => revoked.state === 'blocked');
  assert.equal(credentials, 0);
  assert.equal(Socket.instances.length, 1);
});

test('bounded exponential reconnect backoff is deterministic with an injected clock and cancels on disposal', async context => {
  const clock = new ManualClock();
  const server = new CollabRoomServer({ authorize, clock });
  const Socket = socketConstructor(server, { fail: true });
  const transport = new WebSocketCollabTransport(transportOptions(identity('retry'), Socket, {
    clock, retryMinimumMs: 10, retryMaximumMs: 25, random: () => 0.5
  }));
  context.after(async () => { transport.dispose(); await server.dispose(); });
  transport.start();
  await settle();
  assert.equal(Socket.instances.length, 1);
  await clock.advance(9);
  assert.equal(Socket.instances.length, 1);
  await clock.advance(1);
  assert.equal(Socket.instances.length, 2);
  await clock.advance(20);
  assert.equal(Socket.instances.length, 3);
  await clock.advance(25);
  assert.equal(Socket.instances.length, 4);
  transport.dispose();
  await clock.advance(10000);
  assert.equal(Socket.instances.length, 4);
  assert.equal(clock.timers.size, 0);
});

test('heartbeat accepts its nonce and explicit reconnect resets session state before the new connection', async context => {
  const clock = new ManualClock();
  const server = new CollabRoomServer({ authorize, clock });
  const Socket = socketConstructor(server);
  const transport = new WebSocketCollabTransport(transportOptions(identity('heartbeat'), Socket, {
    clock, heartbeatMs: 15, pongTimeoutMs: 5
  }));
  context.after(async () => { transport.dispose(); await server.dispose(); });
  const events = [];
  transport.subscribe(event => events.push(event.type));
  transport.start();
  await settle();
  await clock.advance(20);
  assert.equal(transport.state, 'open');
  assert(Socket.instances[0].sent.some(frame => JSON.parse(frame).type === 'ping'));
  events.length = 0;
  transport.reconnect();
  assert.equal(events[0], 'close');
  await settle();
  assert.equal(transport.state, 'open');
  assert.equal(Socket.instances.length, 2);
});

test('pending token acquisition is aborted by disposal and backpressure rejects a bounded send', async context => {
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const pending = deferred();
  let signal;
  const transport = new WebSocketCollabTransport(transportOptions(identity('pending'), Socket, {
    tokenProvider: input => { signal = input.signal; return pending.promise; }
  }));
  context.after(async () => { transport.dispose(); await server.dispose(); });
  transport.start();
  await settle();
  transport.dispose();
  assert(signal.aborted);
  pending.resolve('late-secret');
  await settle();
  assert.equal(Socket.instances.length, 0);
  assert.throws(() => transport.start(), error => error.code === 'Disposed');
  const active = new WebSocketCollabTransport(transportOptions(identity('active'), Socket, { maxBufferedBytes: 1024 }));
  context.after(() => active.dispose());
  active.start();
  await waitFor(() => active.connected);
  Socket.instances[0].bufferedAmount = 1024;
  assert.throws(() => active.send(collaborationMessage('sync-request')), error => error.code === 'Limit');
});

test('unsafe URLs, unknown wire versions and invalid timer bounds produce explicit diagnostics', async context => {
  const options = transportOptions(identity('client'), class {});
  for (const url of ['https://example.test', 'ws://example.test', 'wss://name:secret@example.test', 'wss://example.test/?token=secret']) {
    assert.throws(() => new WebSocketCollabTransport({ ...options, url }), error => error.code === 'Unsafe');
  }
  assert.throws(() => new WebSocketCollabTransport({ ...options, retryMinimumMs: 0 }), error => error.code === 'Limit');
  assert.doesNotThrow(() => new WebSocketCollabTransport({ ...options, url: 'ws://127.0.0.1/collab', allowInsecureLoopback: true }));
  const server = new CollabRoomServer({ authorize });
  const Socket = socketConstructor(server);
  const transport = new WebSocketCollabTransport(transportOptions(identity('client'), Socket));
  context.after(async () => { transport.dispose(); await server.dispose(); });
  transport.start();
  await waitFor(() => transport.connected);
  Socket.instances[0].onmessage({ data: '{"type":"presence","version":999}' });
  assert.equal(transport.state, 'blocked');
});

