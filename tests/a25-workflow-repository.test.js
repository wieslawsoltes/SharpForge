import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRepository } from '../packages/git/src/repository.js';
import { encodeIndex } from '../packages/git/src/index-file.js';
import { formatPorcelainV2 } from '../packages/git/src/status.js';
import { formatPatch } from '../packages/git/src/diff/patch.js';
import { repository, commitFile, fileText, objectText, identity } from './a25-workflow-fixtures.js';

test('stage/commit/amend preserves identities, mode, message cleanup and exact immutable parent trees', async () => {
  const repo = await repository();
  await repo.worktree.write('code/main.js', 'first\n', { mode: 0o100755 });
  await repo.add(['code']);
  assert.equal((await repo.status())[0].code, 'A.');
  const first = await repo.commit({ message: '# comment\nSubject  \n\n\nBody\n', author: identity, committer: identity });
  assert.equal(first.message, 'Subject\n\nBody\n');
  assert.deepEqual(first.parents, []);
  assert.equal((await repo.readTree(first.oid)).get('code/main.js').mode, 0o100755);
  assert.deepEqual(await repo.status(), []);
  await repo.worktree.write('code/main.js', 'second\n', { mode: 0o100755 });
  await repo.add(['.']);
  const amended = await repo.commit({ amend: true, message: 'Revised', committer: identity });
  assert.deepEqual(amended.parents, []);
  assert.notEqual(first.oid, amended.oid);
  assert.equal((await repo.readCommit(amended.oid)).author, (await repo.readCommit(first.oid)).author);
  await assert.rejects(repo.commit({ message: 'empty', author: identity, committer: identity }), { code: 'Conflict' });
  await repo.commit({ message: 'allowed', author: identity, committer: identity, allowEmpty: true });
});

test('partial staging, intent-to-add, cached remove, move and path reset preserve three distinct versions', async () => {
  const repo = await repository();
  await commitFile(repo, 'a.txt', 'one\ntwo\nthree\n');
  await repo.worktree.write('a.txt', 'ONE\ntwo\nTHREE\n');
  const patch = formatPatch('one\ntwo\nthree\n', 'ONE\ntwo\nthree\n', { path: 'a.txt' });
  await repo.stagePatch('a.txt', patch);
  assert.equal(await objectText(repo, repo.index.get('a.txt').oid), 'ONE\ntwo\nthree\n');
  assert.equal(await fileText(repo, 'a.txt'), 'ONE\ntwo\nTHREE\n');
  assert.equal((await repo.status())[0].code, 'MM');
  await repo.move('a.txt', 'folder/b.txt');
  assert.equal(await fileText(repo, 'a.txt'), null);
  assert.equal(await objectText(repo, repo.index.get('folder/b.txt').oid), 'ONE\ntwo\nthree\n');
  await repo.unstage(['.']);
  assert.ok(repo.index.get('a.txt'));
  assert.equal(repo.index.get('folder/b.txt'), null);
  await repo.worktree.write('new.txt', 'pending');
  await repo.add(['new.txt'], { intentToAdd: true });
  assert.equal(repo.index.get('new.txt').intentToAdd, true);
  await repo.add(['new.txt']);
  await repo.remove(['new.txt'], { cached: true });
  assert.equal(await fileText(repo, 'new.txt'), 'pending');
});

test('checkout detects dirty staged/worktree/editor state before writing any file or index byte', async () => {
  const repo = await repository();
  const first = await commitFile(repo, 'a.txt', 'one\n');
  await repo.branch('old', { start: first.oid });
  await commitFile(repo, 'a.txt', 'two\n');
  await repo.worktree.write('a.txt', 'unsaved\n');
  const before = await encodeIndex(repo.index);
  await assert.rejects(repo.checkout('old'), error => error.code === 'Conflict' && error.details.paths.includes('a.txt'));
  assert.deepEqual(await encodeIndex(repo.index), before);
  assert.equal(await fileText(repo, 'a.txt'), 'unsaved\n');
  await repo.restore(['a.txt']);
  await assert.rejects(repo.checkout('old', { dirtyPaths: ['a.txt'] }), { code: 'Conflict' });
  await repo.checkout('old');
  assert.equal(await fileText(repo, 'a.txt'), 'one\n');
  assert.equal((await repo.refs.resolve('HEAD')).ref, 'refs/heads/old');
});

test('branch/tag operations enforce ancestry and preserve annotated targets and reflog recovery', async () => {
  const repo = await repository();
  const base = await commitFile(repo, 'a', 'base');
  await repo.branch('topic');
  await repo.checkout('topic');
  const topic = await commitFile(repo, 'a', 'topic');
  await repo.branch('topic', { rename: 'renamed' });
  assert.equal((await repo.refs.resolve('HEAD')).ref, 'refs/heads/renamed');
  await repo.checkout('main');
  await assert.rejects(repo.branch('renamed', { delete: true }), { code: 'Conflict' });
  const tag = await repo.tag('v1', { target: topic.oid, message: 'release', tagger: identity });
  assert.equal(await repo.revParse('v1^{}'), topic.oid);
  assert.equal(await repo.revParse('v1^{tree}'), (await repo.readCommit(topic.oid)).tree);
  assert.notEqual(tag.oid, topic.oid);
  await repo.branch('renamed', { delete: true, force: true });
  assert.equal(await repo.refs.read('refs/heads/renamed'), null);
  assert.equal(await repo.revParse('HEAD'), base.oid);
});

test('checkout stores 5,000 files outside the open-document workspace collection', async () => {
  const repo = await repository();
  const empty = await repo.commit({ message: 'root', allowEmpty: true, author: identity, committer: identity });
  for (let index = 0; index < 5000; index++) await repo.worktree.write(`files/${index}.txt`, `file ${index}\n`);
  await repo.add(['files']);
  const full = await repo.commit({ message: 'five thousand', author: identity, committer: identity });
  await repo.checkout(empty.oid);
  assert.equal((await repo.worktree.list()).length, 0);
  await repo.checkout(full.oid);
  assert.equal((await repo.worktree.list()).length, 5000);
  assert.equal(repo.worktree.documents, undefined);
  assert.equal(await fileText(repo, 'files/4999.txt'), 'file 4999\n');
});

test('persisted reload sees index state and CAS rejects another instance overwriting it', async () => {
  const first = await repository();
  const second = new GitRepository({ odb: first.odb, refs: first.refs, worktree: first.worktree, store: first.store });
  await second.init();
  await first.worktree.write('a', 'one');
  await first.add(['a']);
  await assert.rejects(second.add(['a']), { code: 'Conflict' });
  await second.loadIndex();
  assert.equal(second.index.get('a').oid, first.index.get('a').oid);
  const records = await first.status();
  assert.match(formatPorcelainV2(records), /^1 A\. N\.\.\. 000000 100644 100644 /u);
});
