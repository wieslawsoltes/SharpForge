import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCommit, encodeTree } from '../packages/git/src/objects.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { ScopedRepositoryStore, ScopedWorktree } from '../packages/git/src/adjunct/scoped-storage.js';
import { openService, commitFiles, objectFixture, smartResponse, authorize, identity, text, decode, remoteUrl } from './git-adjuncts/fixture.js';

const path = 'deps/library';
const childUrl = 'https://git.test/library.git';
const trust = oid => ({ trustedSubmodules: [{ path, url: childUrl, oid }] });

async function pin(repo, oid) {
  repo.index.set({ path, oid, mode: 0o160000, stage: 0 });
  await repo.saveIndex();
  await repo.commit({ message: 'pin ' + oid, author: identity, committer: identity });
}

async function parentFixture(t, options = {}) {
  const fixture = await objectFixture(t);
  const calls = [];
  const { service, repo } = await openService(t, {}, { ...options, fetch: async (url, request) => {
    calls.push({ url, method: request.method });
    return smartResponse(fixture, request);
  } });
  await commitFiles(repo, { '.gitmodules': '[submodule "library"]\n path = deps/library\n url = ../library.git\n' });
  await pin(repo, fixture.tip);
  repo.config.set('remote.origin.url', remoteUrl);
  await repo.config.save();
  await authorize(service);
  return { service, repo, fixture, calls };
}

test('default nested storage clones into the gitlink path without publishing child objects or files into the parent index', async t => {
  const { service, repo, fixture, calls } = await parentFixture(t);
  const before = await repo.store.list('');
  assert.equal((await service.request('submodules'))[0].state, 'uninitialized');
  assert.deepEqual(await repo.store.list(''), before);
  assert.equal(calls.length, 0);
  const result = await service.request('initializeSubmodules', trust(fixture.tip));
  assert.equal(result[0].state, 'initialized');
  assert.equal(decode((await repo.worktree.read(path + '/README.md')).data), 'fixture content\n');
  assert.equal(decode(await repo.store.get('modules/' + path + '/HEAD')).trim(), fixture.tip);
  assert.equal(await repo.odb.has(fixture.tip), false);
  assert.equal(repo.index.get(path).oid, fixture.tip);
  assert.equal(repo.index.get(path + '/README.md'), null);
  assert.deepEqual(await service.request('status'), []);
  const listed = (await service.request('submodules'))[0];
  assert.equal(listed.state, 'initialized');
  assert.equal(listed.checkedOutOid, fixture.tip);
  calls.length = 0;
  await service.request('initializeSubmodules', trust(fixture.tip));
  assert.equal(calls.length, 0);
  await repo.worktree.write('parent.txt', 'parent still open');
  assert.equal(decode((await repo.worktree.read('parent.txt')).data), 'parent still open');
});

test('default nested reuse protects changed worktree content, binds the displayed pin and updates after the conflict is resolved', async t => {
  const { service, repo, fixture } = await parentFixture(t);
  const original = fixture.tip;
  await service.request('initializeSubmodules', trust(original));
  const blob = await fixture.repo.odb.write('blob', text('next content\n'));
  const tree = await fixture.repo.odb.write('tree', encodeTree([{ name: 'README.md', mode: 0o100644, oid: blob }]));
  fixture.tip = await fixture.repo.odb.write('commit', encodeCommit({
    tree, parents: [original], author: identity, committer: identity, message: 'next'
  }));
  fixture.full = (await writePack(await Promise.all((await fixture.repo.odb.list()).map(oid => fixture.repo.odb.read(oid))))).pack;
  await pin(repo, fixture.tip);
  assert.equal((await service.request('initializeSubmodules', trust(original)))[0].reason, 'trust-required');
  await repo.worktree.write(path + '/README.md', 'local child edit\n');
  await assert.rejects(service.request('initializeSubmodules', trust(fixture.tip)), { code: 'Conflict' });
  assert.equal(decode(await repo.store.get('modules/' + path + '/HEAD')).trim(), original);
  assert.equal(decode((await repo.worktree.read(path + '/README.md')).data), 'local child edit\n');
  const status = await service.request('status');
  assert.equal(status.some(record => record.path.startsWith(path + '/')), false);
  assert.ok(status.some(record => record.path === path));
  await repo.worktree.write(path + '/README.md', 'fixture content\n');
  await service.request('initializeSubmodules', trust(fixture.tip));
  assert.equal(decode(await repo.store.get('modules/' + path + '/HEAD')).trim(), fixture.tip);
  assert.equal(decode((await repo.worktree.read(path + '/README.md')).data), 'next content\n');
});

test('default submodule initialization rejects a nonempty unowned destination before contacting its remote', async t => {
  const { service, repo, fixture, calls } = await parentFixture(t);
  await repo.worktree.write(path + '/private.txt', 'keep');
  await assert.rejects(service.request('initializeSubmodules', trust(fixture.tip)), { code: 'Conflict' });
  assert.equal(calls.length, 0);
  assert.equal(decode((await repo.worktree.read(path + '/private.txt')).data), 'keep');
  assert.deepEqual(await repo.store.list('modules/'), []);
});

test('scoped stores and worktrees cannot traverse outside their child and closing a child preserves parent access', async t => {
  const { repo } = await openService(t);
  const store = new ScopedRepositoryStore(repo.store, 'modules/child');
  await store.transaction(async transaction => {
    await transaction.set('HEAD', text('child'));
    await transaction.set('refs/heads/main', text('tip'));
    assert.deepEqual(await transaction.list('refs/'), ['refs/heads/main']);
  });
  assert.equal(decode(await repo.store.get('modules/child/HEAD')), 'child');
  await assert.rejects(async () => store.set('../HEAD', text('escape')), { code: 'Unsafe' });
  const worktree = new ScopedWorktree(repo.worktree, 'child');
  await assert.rejects(async () => worktree.write('../outside', text('escape')), { code: 'Unsafe' });
  await assert.rejects(async () => worktree.write('link', text('../outside'), { mode: 0o120000 }), { code: 'Unsafe' });
  await store.close();
  await assert.rejects(async () => store.get('HEAD'), { code: 'Disposed' });
  await repo.store.set('safe-parent-key', text('still open'));
  assert.equal(decode(await repo.store.get('safe-parent-key')), 'still open');
});
