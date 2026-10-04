import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCollaborationPersistence, IndexedDbCollaborationPersistence } from '../packages/git/src/collab/persistence.js';
import { CollaborationPresence } from '../packages/git/src/collab/presence.js';
import { acquireCollaborationClient } from '../packages/git/src/collab/client-identity.js';
import { identity, document, settle, ManualClock } from './helpers/a25-collab.js';

test('persistence is scoped by workspace, room, document and actor, preserves seed metadata and commits batches atomically', async () => {
  const storage = new MemoryCollaborationPersistence({ limits: { maxOperations: 2 } });
  const value = identity('owner');
  const model = document('owner');
  const seed = model.insert(0, 'one');
  const next = model.insert(3, 'two');
  await storage.append(value, seed, { pending: true, initialize: true });
  await storage.append(value, seed, { pending: false });
  assert.deepEqual((await storage.load(value)).pendingIds, [seed.id]);
  await storage.acknowledge(value, seed.id);
  const restored = await storage.load(value);
  assert.equal(restored.initializationId, seed.id);
  assert.deepEqual(restored.pendingIds, []);
  for (const changed of [identity('other'), { ...value, workspaceId: 'other' }, { ...value, roomId: 'other' }, { ...value, documentId: 'Other.cs' }]) {
    assert.equal((await storage.load(changed)).snapshot.updates.length, 0);
  }
  await assert.rejects(storage.appendMany(value, [
    { update: next, pending: true }, { update: { ...seed, inserts: [{ ...seed.inserts[0], value: 'X' }, ...seed.inserts.slice(1)] } }
  ]), error => error.code === 'Conflict');
  assert.equal((await storage.load(value)).snapshot.updates.length, 1);
  await assert.rejects(storage.append(value, document('other').insert(0, 'spoof'), { pending: true }), error => error.code === 'Auth');
  await storage.clear(value);
  assert.equal((await storage.load(value)).snapshot.updates.length, 0);
  storage.dispose();
  await assert.rejects(storage.load(value), error => error.code === 'Disposed');
  const absent = new IndexedDbCollaborationPersistence({ indexedDB: null });
  await assert.rejects(absent.load(value), error => error.code === 'Unsupported');
  absent.dispose();
});

test('presence anchors follow concurrent text, reject stale updates and expire on the injected clock', async () => {
  const clock = new ManualClock();
  const model = document('first');
  model.insert(0, 'abcd');
  const first = new CollaborationPresence({ document: model, identity: identity('first'), clock, ttlMs: 10 });
  const second = new CollaborationPresence({ document: model, identity: identity('second'), clock, ttlMs: 10, maxPeers: 1 });
  const state = first.setLocal({ anchor: 2, focus: 3, name: 'First', color: '#123456' });
  second.receive('first', state.sequence, state.presence);
  assert.deepEqual(second.peers[0].selection, { anchor: 2, focus: 3 });
  model.insert(0, '!');
  assert.deepEqual(second.peers[0].selection, { anchor: 3, focus: 4 });
  second.receive('first', 0, { ...state.presence, name: 'stale' });
  assert.equal(second.peers[0].name, 'First');
  assert.throws(() => second.receive('third', 1, state.presence), error => error.code === 'Limit');
  assert.throws(() => first.setLocal({ color: 'url(unsafe)' }), error => error.code === 'Corrupt');
  await clock.advance(10);
  assert.deepEqual(second.peers, []);
  first.dispose();
  second.dispose();
  assert.equal(clock.timers.size, 0);
  assert.throws(() => first.refresh(), error => error.code === 'Disposed');
});

test('reload-safe actors retain their id, cloned tabs fork an occupied id, and unsupported ownership is explicit', async () => {
  const held = new Set();
  const locks = { request: async (name, options, callback) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } };
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let counter = 0;
  const options = { ...identity('unused'), storage, locks, crypto: { randomUUID: () => 'actor-' + ++counter } };
  const first = await acquireCollaborationClient(options);
  const cloneValues = new Map(values);
  const clone = await acquireCollaborationClient({ ...options,
    storage: { getItem: key => cloneValues.get(key), setItem: (key, value) => cloneValues.set(key, value) } });
  assert.notEqual(clone.clientId, first.clientId);
  first.release();
  await settle();
  const reload = await acquireCollaborationClient(options);
  assert.equal(reload.clientId, first.clientId);
  clone.release();
  reload.release();
  await settle();
  assert.equal(held.size, 0);
  await assert.rejects(acquireCollaborationClient({ ...options, locks: {} }), error => error.code === 'Unsupported');
});
