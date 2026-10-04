import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceRevisionChannel, WorkspaceSaveLocks, WorkspaceConflictCoordinator, hashWorkspaceBytes}
  from '@sharpforge/workspace';

const bytes = text => new TextEncoder().encode(text);
const digest = text => hashWorkspaceBytes(bytes(text));

function channelTransport() {
  const groups = new Map();
  return name => {
    const members = groups.get(name) ?? new Set();
    groups.set(name, members);
    const endpoint = new EventTarget();
    members.add(endpoint);
    endpoint.postMessage = data => {
      for (const receiver of members) {
        if (receiver === endpoint) continue;
        queueMicrotask(() => receiver.dispatchEvent(new MessageEvent('message', {data: structuredClone(data)})));
      }
    };
    endpoint.close = () => members.delete(endpoint);
    return endpoint;
  };
}

function serialLocks() {
  const tails = new Map();
  return {request(name, options, action) {
    const result = (tails.get(name) ?? Promise.resolve()).then(() => {
      options.signal?.throwIfAborted();
      return action();
    });
    tails.set(name, result.then(() => {}, () => {}));
    return result;
  }};
}

test('revision channels mark peer buffers stale without modifying them and discard duplicate envelopes', async () => {
  const transport = channelTransport(), updates = [], errors = [];
  const first = new WorkspaceRevisionChannel({identity: 'same', windowId: 'first', channelFactory: transport});
  const second = new WorkspaceRevisionChannel({identity: 'same', windowId: 'second', channelFactory: transport,
    onRevision: value => updates.push(value), onError: error => errors.push(error)});
  const oldHash = await digest('old'), newHash = await digest('new');
  first.publishRevision({path: 'A.cs', revision: 1, hash: oldHash});
  second.publishRevision({path: 'A.cs', revision: 1, hash: oldHash});
  await new Promise(resolve => setImmediate(resolve));
  updates.length = 0;
  first.publishRevision({path: 'A.cs', revision: 2, hash: newHash, baseHash: oldHash});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].stale, true);
  assert.equal(second.documents.get('A.cs').hash, oldHash, 'an incoming revision cannot replace buffer contents');
  second.receive(updates[0]);
  assert.equal(updates.length, 1, 'same sequence cannot be delivered twice');
  second.receive({identity: 'another-workspace', version: 999});
  assert.equal(errors.length, 0);
  second.dispose();
  assert.throws(() => second.publishRevision({path: 'A.cs', revision: 3, hash: newHash}), /disposed/i);
  first.dispose();
});

test('two windows saving one baseline yield one commit and one conflict', async () => {
  const locks = serialLocks();
  const first = new WorkspaceSaveLocks({identity: 'same', locks});
  const second = new WorkspaceSaveLocks({identity: 'same', locks});
  let stored = bytes('original'), writes = 0;
  const expectedHash = await hashWorkspaceBytes(stored);
  const save = (coordinator, text) => coordinator.guardedSave({path: 'A.cs', expectedHash,
    read: () => stored.slice(), write: () => { stored = bytes(text); writes++; return text; }});
  const results = await Promise.allSettled([save(first, 'first'), save(second, 'second')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const conflict = results.find(result => result.status === 'rejected');
  assert.equal(conflict.reason.code, 'SFW1411');
  assert.equal(writes, 1);
  assert.equal(new TextDecoder().decode(stored), 'first');
  first.dispose();
  second.dispose();
});

test('save ownership rejects unavailable APIs and cancellation without writing', async () => {
  let written = false;
  const unsupported = new WorkspaceSaveLocks({identity: 'workspace', locks: null});
  await assert.rejects(unsupported.guardedSave({path: 'new.bin', expectedHash: null,
    read: () => null, write: () => { written = true; }}), /Web Locks/i);
  const coordinator = new WorkspaceSaveLocks({identity: 'workspace', locks: serialLocks()});
  await assert.rejects(coordinator.guardedSave({path: 'new.bin', expectedHash: null,
    read: () => null, write: () => { written = true; }, signal: AbortSignal.abort()}), {name: 'AbortError'});
  coordinator.dispose();
  await assert.rejects(coordinator.run('new.bin', () => {}), /disposed/i);
  assert.equal(written, false);
});

test('cross-window conflicts require a choice and merge disjoint edits with a new shared revision', async () => {
  const baseContent = 'one\ntwo\nthree\n';
  const mine = 'ONE\ntwo\nthree\n', theirs = 'one\ntwo\nTHREE\n';
  let local = {content: mine, baseContent, revision: 4, hash: await digest(mine)};
  const remote = {path: 'A.cs', revision: 7, hash: await digest(theirs)};
  const publications = [];
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution: value => { local = {...local, ...value}; },
    channel: {publishRevision: value => publications.push(value)}});
  assert.deepEqual(coordinator.observe(remote).choices, ['adopt-newer', 'keep-mine', 'merge']);
  assert.equal(local.content, mine);
  await assert.rejects(coordinator.resolve('A.cs', 'automatic'), /explicit/i);
  const result = await coordinator.resolve('A.cs', 'merge', {readRemote: async () => ({text: theirs})});
  assert.equal(result.status, 'merged');
  assert.equal(local.content, 'ONE\ntwo\nTHREE\n');
  assert.equal(local.revision, 8);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].hash, await digest(local.content));
});

test('cross-window resolution rejects local or remote edits made after the conflict was presented', async () => {
  const local = {content: 'mine', baseContent: 'base', revision: 2, hash: await digest('mine')};
  const remote = {path: 'A.cs', revision: 3, hash: await digest('remote')};
  let applied = false;
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution: () => { applied = true; }, channel: {publishRevision() {}}});
  coordinator.observe(remote);
  local.revision++;
  local.content = 'newer local edit';
  local.hash = await digest(local.content);
  await assert.rejects(coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => ({text: 'remote'})}), /changed/i);
  coordinator.observe(remote);
  await assert.rejects(coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => ({text: 'changed remote'})}), /changed/i);
  assert.equal(applied, false);
  assert.equal(local.content, 'newer local edit');
});
