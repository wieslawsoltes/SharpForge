import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStore, ObjectDatabase, RefDatabase, GitConfig, RemoteManager, encodeCommit, encodeShallow
} from '../packages/git/src/index.js';

const identity = { name: 'Shallow fixture', email: 'shallow@example.test', timestamp: 1700000000, timezone: '+0000' };

test('ahead/behind refreshes shortened boundaries even when all older objects remain locally present', async () => {
  const store = new MemoryStore();
  const odb = new ObjectDatabase({ store });
  const refs = new RefDatabase({ store });
  const config = new GitConfig({ store });
  const manager = new RemoteManager({ odb, refs, config });
  const tree = await odb.write('tree', new Uint8Array());
  const commit = async (parents, message) => odb.write('commit', encodeCommit({ tree, parents,
    author: identity, committer: identity, message }));
  const base = await commit([], 'base');
  const boundary = await commit([base], 'left boundary');
  const tip = await commit([boundary], 'left tip');
  const upstream = await commit([base], 'right tip');
  await refs.update('refs/heads/main', tip);
  await refs.update('refs/remotes/origin/main', upstream);
  const count = options => manager.aheadBehind('refs/heads/main', 'refs/remotes/origin/main', options);
  assert.deepEqual(await count(), { ahead: 2, behind: 1 });
  await store.set('shallow', encodeShallow([boundary]));
  assert.equal(await odb.has(base), true, 'Shortening retains old object bytes');
  assert.deepEqual(await count(), { ahead: 2, behind: 2 });
  await store.set('shallow', encodeShallow([tip]));
  assert.deepEqual(await count(), { ahead: 1, behind: 2 });
  await store.delete('shallow');
  assert.deepEqual(await count(), { ahead: 2, behind: 1 });
  await store.set('shallow', new TextEncoder().encode('invalid-object-id\n'));
  await assert.rejects(count(), { code: 'Corrupt' });
  await store.delete('shallow');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(count({ signal: controller.signal }), { code: 'Cancelled' });
});
