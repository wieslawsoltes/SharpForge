import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceRevisionChannel, WorkspaceConflictCoordinator, hashWorkspaceBytes} from '@sharpforge/workspace';

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

test('coordinator snapshots local admission before an awaited remote read mutates the same object', async () => {
  const local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const remote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('theirs'))};
  let applied = false;
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution() { applied = true; }, channel: {publishRevision() {}}});
  coordinator.observe(remote);
  await assert.rejects(coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => {
    local.content = 'new local edit';
    local.hash = await hashWorkspaceBytes(bytes(local.content));
    local.revision++;
    return {text: 'theirs'};
  }}), /changed/i);
  assert.equal(applied, false);
  assert.equal(local.content, 'new local edit');
  assert(coordinator.conflicts.has('A.cs'));
});

test('a newer notification invalidates an older remote checkpoint before conflict application', async () => {
  const local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const oldRemote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('old remote'))};
  const newRemote = {path: 'A.cs', revision: 4, hash: await hashWorkspaceBytes(bytes('new remote'))};
  let applied = false;
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution() { applied = true; }, channel: {publishRevision() {}}});
  coordinator.observe(oldRemote);
  await assert.rejects(coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => {
    coordinator.observe(newRemote);
    return {text: 'old remote'};
  }}), /remote.*changed/i);
  assert.equal(applied, false);
  assert.equal(coordinator.conflicts.get('A.cs').remote.hash, newRemote.hash);
  assert.equal(coordinator.pending.size, 0);
});

for (const newer of ['newer remote', 'mine']) test(`a remote notification during async application remains visible (${newer})`, async () => {
  let local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const oldRemote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('old remote'))};
  const newRemote = {path: 'A.cs', revision: 4, hash: await hashWorkspaceBytes(bytes(newer))};
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local, channel: {publishRevision() {}},
    applyResolution: async selected => {
      coordinator.observe(newRemote);
      local = {...local, ...selected};
    }});
  coordinator.observe(oldRemote);
  const result = await coordinator.resolve('A.cs', 'adopt-newer', {readRemote: async () => ({text: 'old remote'})});
  assert.equal(result.pendingConflict, true);
  assert.equal(local.content, 'old remote', 'the admitted choice was committed before the newer notification was reconciled');
  assert.equal(coordinator.conflicts.get('A.cs').remote.hash, newRemote.hash);
  assert.equal(coordinator.conflicts.get('A.cs').local.hash, oldRemote.hash);
  assert.equal(coordinator.pending.size, 0);
});

test('a document admits one resolution at a time and cancellation reads no remote checkpoint', async () => {
  let local = {content: 'mine', baseContent: 'base', revision: 2, hash: await hashWorkspaceBytes(bytes('mine'))};
  const remote = {path: 'A.cs', revision: 3, hash: await hashWorkspaceBytes(bytes('theirs'))};
  const coordinator = new WorkspaceConflictCoordinator({getDocument: () => local,
    applyResolution: selected => { local = {...local, ...selected}; }, channel: {publishRevision() {}}});
  coordinator.observe(remote);
  let reads = 0, release;
  const pause = new Promise(resolve => { release = resolve; });
  const readRemote = () => { reads++; return pause; };
  await assert.rejects(coordinator.resolve('A.cs', 'keep-mine', {readRemote, signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(reads, 0);
  const first = coordinator.resolve('A.cs', 'adopt-newer', {readRemote});
  await assert.rejects(coordinator.resolve('A.cs', 'keep-mine', {readRemote}), /already in progress/i);
  release({text: 'theirs'});
  await first;
  assert.equal(reads, 1);
  assert.equal(coordinator.pending.size, 0);
});

