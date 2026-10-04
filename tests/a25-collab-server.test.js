import test from 'node:test';
import assert from 'node:assert/strict';
import { CollabRoomServer } from '../packages/git/src/collab/room-server.js';
import { GitError } from '../packages/git/src/errors.js';
import { client, identity, document, authorize, deferred, settle, ManualClock } from './helpers/a25-collab.js';

test('wrong room token, anonymous messages and cross-workspace clients receive no document or presence', async context => {
  let loads = 0;
  const server = new CollabRoomServer({ authorize, persistence: { load: () => { loads++; return null; }, append() {} } });
  context.after(() => server.dispose());
  const owner = client(server, identity('owner'));
  await owner.authenticate();
  const update = document('owner').insert(0, 'private document');
  await owner.send('update', { update });
  await owner.send('presence', { sequence: 1, presence: { name: 'Owner', color: '#336699', selection: null } });
  const denied = client(server, identity('intruder'));
  await denied.authenticate('wrong-room-token');
  assert.deepEqual(denied.messages.map(message => message.type), ['error']);
  assert.equal(denied.messages[0].error.code, 'Auth');
  assert.equal(loads, 1);
  assert(!JSON.stringify(denied.messages).includes('private document'));
  const anonymous = client(server, identity('anonymous'));
  await anonymous.send('sync-request');
  assert.deepEqual(anonymous.messages.map(message => message.type), ['error']);
  const other = client(server, identity('other', { workspaceId: 'another' }));
  await other.authenticate();
  await other.send('sync-request');
  assert.deepEqual(other.messages[0].peers, []);
  assert.equal(other.messages.find(message => message.type === 'sync-start').count, 0);
  await other.send('signal', { targetClientId: 'owner', signal: { sessionId: 'rtc-1', request: true } });
  assert.equal(other.messages.at(-1).type, 'peer-left');
  assert.equal(other.closed.length, 0);
  assert(!owner.messages.some(message => message.type === 'signal'));
});

test('a peer leaving during negotiation does not revoke the remaining client connection', async context => {
  const server = new CollabRoomServer({ authorize });
  context.after(() => server.dispose());
  const first = client(server, identity('first'));
  const second = client(server, identity('second'));
  await first.authenticate();
  await second.authenticate();
  second.connection.close();
  await first.send('signal', { targetClientId: 'second', signal: { sessionId: 'rtc-1', request: true } });
  assert.equal(first.messages.at(-1).type, 'peer-left');
  assert.equal(first.closed.length, 0);
  await first.send('update', { update: document('first').insert(0, 'still editable') });
  assert.equal(first.messages.at(-1).type, 'ack');
});

test('durable append completes before update broadcast or acknowledgment, and duplicate replay is idempotent', async context => {
  const committed = deferred();
  let appends = 0;
  const server = new CollabRoomServer({ authorize, persistence: { load: () => null, append: () => { appends++; return committed.promise; } } });
  context.after(() => server.dispose());
  const writer = client(server, identity('writer'));
  const reader = client(server, identity('reader'));
  await writer.authenticate();
  await reader.authenticate();
  const update = document('writer').insert(0, 'durable');
  const sending = writer.send('update', { update });
  await settle();
  assert(!writer.messages.some(message => message.type === 'ack'));
  assert(!reader.messages.some(message => message.type === 'update'));
  committed.resolve();
  await sending;
  await settle();
  assert.equal(writer.messages.at(-1).id, update.id);
  assert.equal(reader.messages.at(-1).update.id, update.id);
  await writer.send('update', { update });
  assert.equal(appends, 1);
  assert.equal(reader.messages.filter(message => message.type === 'update').length, 1);
});

test('failed durable append leaves room state unchanged and never exposes adapter secrets', async context => {
  const server = new CollabRoomServer({ authorize, persistence: {
    load: () => null, append: () => { throw new GitError('Quota', 'fixture-secret-token should never leave this adapter'); }
  } });
  context.after(() => server.dispose());
  const writer = client(server, identity('writer'));
  await writer.authenticate();
  await writer.send('update', { update: document('writer').insert(0, 'not committed') });
  assert(!writer.messages.some(message => message.type === 'ack'));
  assert(!JSON.stringify(writer.messages).includes('fixture-secret-token'));
  const reader = client(server, identity('reader'));
  await reader.authenticate();
  await reader.send('sync-request');
  assert.equal(reader.messages.find(message => message.type === 'sync-start').count, 0);
});

test('room seed compare-and-set accepts one creator and safely recognizes its reload replay', async context => {
  const server = new CollabRoomServer({ authorize });
  context.after(() => server.dispose());
  const first = client(server, identity('first'));
  const second = client(server, identity('second'));
  await first.authenticate();
  await second.authenticate();
  const seed = document('first').insert(0, 'existing code');
  await Promise.all([
    first.send('initialize', { update: seed }),
    second.send('initialize', { update: document('second').insert(0, 'existing code') })
  ]);
  assert.equal(first.messages.find(message => message.type === 'initialized').accepted, true);
  assert.equal(second.messages.find(message => message.type === 'initialized').accepted, false);
  await first.send('initialize', { update: seed });
  assert.equal(first.messages.at(-1).accepted, true);
  await second.send('sync-request');
  assert.equal(second.messages.find(message => message.type === 'sync-start').count, 1);
});

test('readonly grants, actor spoofing and duplicate live identities are rejected without affecting the owner', async context => {
  const server = new CollabRoomServer({ authorize: input => ({
    ...authorize(input), permissions: { read: true, write: input.identity.clientId !== 'reader' }
  }) });
  context.after(() => server.dispose());
  const owner = client(server, identity('owner'));
  await owner.authenticate();
  const duplicate = client(server, identity('owner'));
  await duplicate.authenticate();
  assert.equal(duplicate.messages.at(-1).error.code, 'Conflict');
  assert.equal(owner.closed.length, 0);
  const reader = client(server, identity('reader'));
  await reader.authenticate();
  await reader.send('update', { update: document('reader').insert(0, 'forbidden') });
  assert.equal(reader.messages.at(-1).error.code, 'Auth');
  const spoof = client(server, identity('spoof'));
  await spoof.authenticate();
  await spoof.send('update', { update: document('owner').insert(0, 'forged') });
  assert.equal(spoof.messages.at(-1).error.code, 'Auth');
});

test('presence sequences, peer identity and signaling origin are stamped by the room authority', async context => {
  const server = new CollabRoomServer({ authorize });
  context.after(() => server.dispose());
  const first = client(server, identity('first'));
  const second = client(server, identity('second'));
  await first.authenticate();
  await second.authenticate();
  const presence = { name: '<b>safe text</b>', color: '#663399', selection: null };
  await first.send('presence', { sequence: 2, presence, clientId: 'forged' });
  await first.send('presence', { sequence: 1, presence: { ...presence, name: 'stale' } });
  await first.send('signal', { sourceClientId: 'forged', targetClientId: 'second', signal: { sessionId: 'rtc-1', request: true } });
  await settle();
  assert.equal(second.messages.filter(message => message.type === 'presence').length, 1);
  assert.equal(second.messages.find(message => message.type === 'presence').clientId, 'first');
  assert.equal(second.messages.at(-1).sourceClientId, 'first');
  const newcomer = client(server, identity('newcomer'));
  await newcomer.authenticate();
  assert.equal(newcomer.messages[0].peers[0].sequence, 2);
});

test('authentication timeouts, expiration, cancellation and connection limits release ownership', async context => {
  const clock = new ManualClock();
  const pending = deferred();
  let signal;
  const server = new CollabRoomServer({ clock, authTimeoutMs: 10, maxConnections: 2, authorize: input => {
    signal = input.signal;
    return pending.promise;
  } });
  context.after(() => server.dispose());
  const value = client(server, identity('pending'));
  const authenticating = value.authenticate();
  client(server, identity('other'));
  assert.throws(() => client(server, identity('overflow')), error => error.code === 'Limit');
  await settle();
  await clock.advance(10);
  assert(signal.aborted);
  pending.resolve({ identity: value.identity, permissions: { read: true, write: true } });
  await authenticating;
  assert.deepEqual(value.messages, []);
  const expiring = new CollabRoomServer({ clock, authorize: input => ({ ...authorize(input), expiresAt: clock.now() + 10 }) });
  context.after(() => expiring.dispose());
  const active = client(expiring, identity('active'));
  await active.authenticate();
  await clock.advance(10);
  assert.equal(active.closed[0].code, 1008);
  await expiring.dispose();
  assert.throws(() => client(expiring, identity('closed')), error => error.code === 'Disposed');
});
