import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRepository } from '../packages/git/src/repository.js';
import { repository, commitFile, fileText, identity } from './a25-workflow-fixtures.js';

test('cherry-pick and revert replay trees and record recoverable operation state', async () => {
  const repo = await repository();
  await commitFile(repo, 'a', 'base');
  await repo.branch('topic');
  await repo.checkout('topic');
  const picked = await commitFile(repo, 'b', 'picked');
  await repo.checkout('main');
  const applied = await repo.cherryPick(picked.oid, { committer: identity });
  assert.equal(applied.status, 'completed');
  assert.equal(await fileText(repo, 'b'), 'picked');
  const reversed = await repo.revert(applied.oid, { author: identity, committer: identity });
  assert.equal(reversed.status, 'completed');
  assert.equal(await fileText(repo, 'b'), null);
  assert.equal(await repo.readState('sequencer'), null);
});

test('conflicted rebase survives repository reload and abort restores the original branch and files', async () => {
  const repo = await repository();
  await commitFile(repo, 'a', 'base\n');
  await repo.branch('topic');
  await commitFile(repo, 'a', 'main\n');
  await repo.checkout('topic');
  const original = await commitFile(repo, 'a', 'topic\n');
  assert.equal((await repo.rebase('main', { committer: identity })).status, 'conflicted');
  const reopened = new GitRepository({ odb: repo.odb, refs: repo.refs, worktree: repo.worktree, store: repo.store });
  await reopened.init();
  assert.ok(await reopened.readState('rebase'));
  const aborted = await reopened.rebase(null, { abort: true });
  assert.equal(aborted.oid, original.oid);
  assert.equal((await reopened.refs.resolve('HEAD')).ref, 'refs/heads/topic');
  assert.equal(await fileText(reopened, 'a'), 'topic\n');
  assert.deepEqual(await reopened.status(), []);
});

test('interactive rebase supports pick, squash, fixup and drop with preserved authors', async () => {
  const repo = await repository();
  const base = await commitFile(repo, 'base', 'base');
  await repo.branch('topic');
  await commitFile(repo, 'main', 'main');
  await repo.checkout('topic');
  const first = await commitFile(repo, 'one', 'one', { message: 'one' });
  const second = await commitFile(repo, 'two', 'two', { message: 'two' });
  const third = await commitFile(repo, 'three', 'three', { message: 'three' });
  const fourth = await commitFile(repo, 'four', 'four', { message: 'four' });
  const result = await repo.rebase('main', { upstream: base.oid, committer: identity, todo: [
    { action: 'pick', oid: first.oid }, { action: 'squash', oid: second.oid },
    { action: 'fixup', oid: third.oid }, { action: 'drop', oid: fourth.oid }
  ] });
  assert.equal(result.status, 'completed');
  const commit = await repo.readCommit(result.oid);
  assert.equal(commit.message, 'one\n\ntwo\n');
  assert.equal(commit.parents[0], await repo.refs.read('refs/heads/main'));
  assert.equal(await fileText(repo, 'three'), 'three');
  assert.equal(await fileText(repo, 'four'), null);
});

test('stash preserves separate staged/worktree/untracked versions and pop drops only after success', async () => {
  const repo = await repository();
  const base = await commitFile(repo, 'a', 'base\n');
  await repo.worktree.write('a', 'staged\n');
  await repo.add(['a']);
  await repo.worktree.write('a', 'unstaged\n');
  await repo.worktree.write('new', 'untracked');
  const saved = await repo.stash('push', { includeUntracked: true, author: identity, committer: identity });
  assert.equal(saved.status, 'saved');
  assert.equal(saved.parents.length, 3);
  assert.equal(saved.parents[0], base.oid);
  assert.equal(await fileText(repo, 'a'), 'base\n');
  assert.equal(await fileText(repo, 'new'), null);
  assert.equal((await repo.stash('list')).length, 1);
  const applied = await repo.stash('pop', { restoreIndex: true });
  assert.equal(applied.status, 'applied');
  assert.equal(await fileText(repo, 'a'), 'unstaged\n');
  assert.equal(await fileText(repo, 'new'), 'untracked');
  assert.equal((await repo.status()).find(record => record.path === 'a').code, 'MM');
  assert.equal((await repo.stash('list')).length, 0);
});

test('soft, mixed and hard reset preserve their distinct scopes and ORIG_HEAD enables recovery', async () => {
  const repo = await repository();
  const first = await commitFile(repo, 'a', 'one');
  const second = await commitFile(repo, 'a', 'two');
  await repo.reset(first.oid, { mode: 'soft' });
  assert.equal((await repo.status())[0].code, 'M.');
  await repo.reset(first.oid, { mode: 'mixed' });
  assert.equal((await repo.status())[0].code, '.M');
  await repo.reset(second.oid, { mode: 'hard' });
  await repo.reset(first.oid, { mode: 'hard' });
  assert.equal(await fileText(repo, 'a'), 'one');
  assert.equal(await repo.refs.read('ORIG_HEAD'), second.oid);
  await repo.reset('ORIG_HEAD', { mode: 'hard' });
  assert.equal(await fileText(repo, 'a'), 'two');
  assert.ok((await repo.refs.reflog('HEAD')).some(entry => entry.message.startsWith('reset:')));
});
