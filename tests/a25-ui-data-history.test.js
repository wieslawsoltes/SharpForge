import test from 'node:test';
import assert from 'node:assert/strict';
import { virtualRange } from '../apps/studio/git-virtual.js';
import { buildReferenceTree } from '../apps/studio/git-repository.js';
import { parseConflictBlocks } from '../apps/studio/git-merge-editor.js';
import { commitFile, fileText, identity } from './a25-workflow-fixtures.js';
import { viewFixture } from './a25-ui-data-fixtures.js';

test('blame pages are bounded, retain original attribution and handle empty trailing ranges', async t => {
  const { repo, run } = await viewFixture(t);
  const root = await commitFile(repo, 'lines.txt', 'one\ntwo\nthree\n');
  const next = await commitFile(repo, 'lines.txt', 'one\nTWO\nthree\nfour');
  const page = await run('blamePage', { path: 'lines.txt', revision: next.oid, start: 1, count: 2 });
  assert.equal(page.total, 4);
  assert.equal(page.revision, next.oid);
  assert.deepEqual(page.lines.map(line => [line.finalLine, line.oid, line.text]), [[2, next.oid, 'TWO'], [3, root.oid, 'three']]);
  assert.equal((await run('blamePage', { path: 'lines.txt', revision: next.oid, start: 4, count: 0 })).lines.length, 0);
  await assert.rejects(run('blamePage', { path: 'lines.txt', count: 1001 }), { code: 'Limit' });
  await assert.rejects(run('blamePage', { path: 'lines.txt', start: 5 }), { code: 'Limit' });
  await assert.rejects(run('blamePage', { path: 'missing.txt' }), { code: 'NotFound' });
  await commitFile(repo, 'binary.bin', new Uint8Array([0, 1]));
  await assert.rejects(run('blamePage', { path: 'binary.bin' }), { code: 'Unsupported' });
});

test('working blame shifts preserved lines and marks inserted lines without changing buffers', async t => {
  const { repo, run } = await viewFixture(t);
  const commit = await commitFile(repo, 'file.txt', 'one\ntwo\nthree\n');
  const edited = 'inserted\none\nTWO\nthree\n';
  await repo.worktree.write('file.txt', edited);
  const page = await run('blamePage', { path: 'file.txt', workingTree: true, start: 0, count: 4 });
  assert.equal(page.workingTree, true);
  assert.equal(page.total, 4);
  assert.deepEqual(page.lines.map(line => [line.finalLine, !!line.uncommitted]), [[1, true], [2, false], [3, true], [4, false]]);
  assert.equal(page.lines[1].oid, commit.oid);
  assert.equal(page.lines[1].originalLine, 1);
  assert.equal(page.lines[0].oid, '0'.repeat(40));
  assert.equal(await fileText(repo, 'file.txt'), edited);
  const second = await run('blamePage', { path: 'file.txt', workingTree: true, revision: page.revision, start: 2, count: 2 });
  assert.equal(second.workingOid, page.workingOid);
  await repo.worktree.write('file.txt', 'one\ntwo\nthree\n');
  await assert.rejects(run('blamePage', { path: 'file.txt', workingTree: true, revision: page.revision,
    workingOid: page.workingOid, start: 2, count: 2 }), { code: 'Conflict' });
  const restored = await run('blamePage', { path: 'file.txt', workingTree: true });
  assert.notEqual(restored.workingOid, page.workingOid);
  assert.ok(restored.lines.every(line => !line.uncommitted));
});

test('repository tree distinguishes branch, remote and tag refs and strips remote credentials', async t => {
  const { repo, run } = await viewFixture(t);
  const commit = await commitFile(repo, 'a', 'a\n');
  await repo.branch('feature/nested');
  await repo.tag('v1', { message: 'Version one', tagger: identity });
  await repo.refs.update('refs/remotes/origin/main', commit.oid, { expected: null });
  repo.config.set('remote.origin.url', 'https://user:secret@example.test/repository.git?access_token=hidden#fragment');
  repo.config.set('remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  const tree = await run('repositoryTree');
  assert.equal(tree.branches.find(branch => branch.current).name, 'refs/heads/main');
  assert.equal(tree.tags[0].name, 'refs/tags/v1');
  assert.equal(tree.remoteBranches[0].name, 'refs/remotes/origin/main');
  assert.equal(tree.remotes[0].url, 'https://example.test/repository.git');
  assert.equal(JSON.stringify(tree).includes('secret'), false);
  const nested = buildReferenceTree(tree.branches, 'refs/heads/');
  assert.equal(nested[0].label, 'feature');
  assert.equal(nested[0].children[0].ref.name, 'refs/heads/feature/nested');
});

test('virtualization keeps million-line and oversized canvas windows bounded and reaches the final line', () => {
  for (const count of [0, 1, 10000, 1000000, 2000000]) {
    const first = virtualRange({ count, rowHeight: 22, viewportHeight: 440 });
    assert.equal(first.start, 0);
    assert.ok(first.end - first.start <= 32);
    assert.ok(first.canvasHeight <= 24000000);
    const last = virtualRange({ count, rowHeight: 22, viewportHeight: 440, scrollTop: 100000000 });
    assert.equal(last.end, count);
    assert.ok(last.end - last.start <= 32);
  }
  assert.throws(() => virtualRange({ count: -1 }), RangeError);
  assert.throws(() => virtualRange({ count: 10, rowHeight: 0 }), RangeError);
});

test('per-conflict resolution offsets preserve adjacent manual edits and parse diff3 base sections', () => {
  const first = '<<<<<<< HEAD\nours\n||||||| base\noriginal\n=======\ntheirs\n>>>>>>> incoming\n';
  const second = '<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> incoming\n';
  const text = `manual prefix\n${first}manual middle\n${second}manual suffix\n`;
  const blocks = parseConflictBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].ours, 'ours\n');
  assert.equal(blocks[0].theirs, 'theirs\n');
  const accepted = text.slice(0, blocks[0].start) + blocks[0].theirs + text.slice(blocks[0].end);
  assert.equal(accepted, `manual prefix\ntheirs\nmanual middle\n${second}manual suffix\n`);
  assert.equal(parseConflictBlocks(accepted).length, 1);
  assert.equal(parseConflictBlocks('<<<<<<< HEAD\nincomplete\n').length, 0);
});
