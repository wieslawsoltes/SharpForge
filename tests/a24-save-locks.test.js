import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSaveLocks, hashWorkspaceBytes} from '@sharpforge/workspace';

const bytes = text => new TextEncoder().encode(text);

test('file saves and whole-workspace transactions use the same workspace ownership key', async () => {
  const requests = [];
  const locks = {request: async (name, options, action) => { requests.push({name, mode: options.mode}); return action(); }};
  const coordinator = new WorkspaceSaveLocks({identity: 'directory:physical', locks});
  await coordinator.run('A.cs', () => {});
  await coordinator.run('*', () => {}, {workspace: true});
  assert.equal(requests[0].name, requests[2].name);
  assert.notEqual(requests[0].name, requests[1].name);
  assert.deepEqual(requests.map(request => request.mode), ['shared', 'exclusive', 'exclusive']);
  coordinator.dispose();
});

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
