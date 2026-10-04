import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeIndex } from '../packages/git/src/index-file.js';
import { repository, commitFile, fileText, identity } from './a25-workflow-fixtures.js';

test('fast-forward and no-ff merge create the correct ancestry and tree', async () => {
  const repo = await repository();
  const base = await commitFile(repo, 'a', 'base\n');
  await repo.branch('topic');
  await repo.checkout('topic');
  const child = await commitFile(repo, 'b', 'topic\n');
  await repo.checkout('main');
  assert.equal((await repo.merge('topic')).status, 'fast-forward');
  assert.equal(await repo.refs.read('HEAD'), child.oid);
  assert.equal(await repo.refs.read('ORIG_HEAD'), base.oid);
  await repo.checkout('topic');
  const another = await commitFile(repo, 'c', 'next\n');
  await repo.checkout('main');
  const merged = await repo.merge('topic', { noFf: true, author: identity, committer: identity });
  assert.equal(merged.status, 'merged');
  assert.deepEqual(merged.parents, [child.oid, another.oid]);
  assert.deepEqual(await repo.graph.mergeBases(merged.oid, another.oid), [another.oid]);
  assert.equal(await repo.graph.isAncestor(base.oid, merged.oid), true);
});

test('conflict stages survive merge and abort restores worktree and index byte-for-byte', async () => {
  const repo = await repository();
  await commitFile(repo, 'a', 'base\n');
  await repo.branch('topic');
  await repo.checkout('topic');
  const theirs = await commitFile(repo, 'a', 'theirs\n');
  await repo.checkout('main');
  const ours = await commitFile(repo, 'a', 'ours\n');
  await repo.worktree.write('untracked', 'preserve me');
  const index = await encodeIndex(repo.index);
  const result = await repo.merge('topic');
  assert.equal(result.status, 'conflicted');
  assert.deepEqual(repo.index.entries.filter(entry => entry.path === 'a').map(entry => entry.stage), [1, 2, 3]);
  assert.match(await fileText(repo, 'a'), /<<<<<<< HEAD/u);
  assert.equal((await repo.readState('MERGE_HEAD')).oids[0], theirs.oid);
  await repo.merge(null, { abort: true });
  assert.equal(await repo.refs.read('HEAD'), ours.oid);
  assert.deepEqual(await encodeIndex(repo.index), index);
  assert.equal(await fileText(repo, 'a'), 'ours\n');
  assert.equal(await fileText(repo, 'untracked'), 'preserve me');
});

test('rename/modify combines content at the renamed path and keeps both parents', async () => {
  const repo = await repository();
  await commitFile(repo, 'old.txt', 'one\ntwo\nthree\n');
  await repo.branch('topic');
  await repo.checkout('topic');
  await commitFile(repo, 'old.txt', 'one\nTWO\nthree\n');
  await repo.checkout('main');
  await repo.move('old.txt', 'new.txt');
  await repo.commit({ message: 'rename', author: identity, committer: identity });
  const merged = await repo.merge('topic', { author: identity, committer: identity });
  assert.equal(merged.status, 'merged');
  assert.equal(await fileText(repo, 'new.txt'), 'one\nTWO\nthree\n');
  assert.equal(await fileText(repo, 'old.txt'), null);
});

test('merge-base retains multiple best ancestors in a criss-cross graph', async () => {
  const repo = await repository();
  const root = await commitFile(repo, 'a', 'root');
  const tree = root.tree;
  const make = async (parents, message) => (await repo.commit({ tree, parents, message, allowEmpty: true, author: identity, committer: identity })).oid;
  const left = await make([root.oid], 'left');
  const right = await make([root.oid], 'right');
  const first = await make([left, right], 'first merge');
  const second = await make([right, left], 'second merge');
  assert.deepEqual(await repo.graph.mergeBases(first, second), [left, right].sort());
  const walked = await repo.graph.walk([first, second]);
  const positions = new Map(walked.map((commit, index) => [commit.oid, index]));
  for (const commit of walked) for (const parent of commit.parents) assert.ok(positions.get(commit.oid) < positions.get(parent));
});
