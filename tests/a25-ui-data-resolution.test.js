import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFixture, conflictStages } from './a25-ui-data-fixtures.js';
import { fileText, objectText, commitFile } from './a25-workflow-fixtures.js';

function resolution(detail, choice, options = {}) {
  return { path: detail.path, stagesKey: detail.stagesKey, workingOid: detail.working.oid, choice, ...options };
}

test('binary conflict resolution preserves the selected blob bytes and executable mode exactly', async t => {
  const { repo, run } = await viewFixture(t);
  const ours = new Uint8Array([0, 1, 255, 3]);
  const theirs = new Uint8Array([0, 200, 254, 9]);
  await conflictStages(repo, 'image.dat', { base: new Uint8Array([0]), ours, theirs, theirsMode: 0o100755 });
  const detail = await run('conflictDetail', { path: 'image.dat' });
  assert.equal(detail.ours.binary, true);
  assert.equal(detail.ours.text, null);
  const resolved = await run('resolveConflictChoice', resolution(detail, 'theirs'));
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.deleted, false);
  assert.equal(resolved.binary, true);
  assert.deepEqual((await repo.worktree.read('image.dat')).data, theirs);
  assert.equal((await repo.worktree.read('image.dat')).mode, 0o100755);
  assert.equal(repo.index.get('image.dat').oid, detail.theirs.oid);
  assert.equal(repo.index.get('image.dat').mode, 0o100755);
  assert.equal(repo.index.unmerged.length, 0);
  assert.ok(repo.index.resolveUndo().some(entry => entry.path === 'image.dat'));
});

test('choosing an absent side deletes the file and all conflict stages', async t => {
  const { repo, run } = await viewFixture(t);
  await conflictStages(repo, 'gone.txt', { base: 'base\n', ours: 'our modification\n', theirs: null });
  const detail = await run('conflictDetail', { path: 'gone.txt' });
  assert.equal(detail.theirs.exists, false);
  const result = await run('resolveConflictChoice', resolution(detail, 'theirs'));
  assert.equal(result.deleted, true);
  assert.equal(await repo.worktree.read('gone.txt'), null);
  assert.equal(repo.index.entries.some(entry => entry.path === 'gone.txt'), false);
});

test('explicit deletion also resolves an add/add conflict with no base', async t => {
  const { repo, run } = await viewFixture(t);
  await conflictStages(repo, 'both.txt', { base: null, ours: 'ours', theirs: 'theirs' });
  const detail = await run('conflictDetail', { path: 'both.txt' });
  const result = await run('resolveConflictChoice', resolution(detail, 'delete'));
  assert.equal(result.deleted, true);
  assert.equal(await fileText(repo, 'both.txt'), null);
  assert.equal(repo.index.unmerged.length, 0);
});

test('manual resolution rejects remaining markers and stages only the accepted text', async t => {
  const { repo, run } = await viewFixture(t);
  await conflictStages(repo, 'manual.txt', { base: 'base\n', ours: 'ours\n', theirs: 'theirs\n' });
  const detail = await run('conflictDetail', { path: 'manual.txt' });
  const marker = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> incoming\n';
  await assert.rejects(run('resolveConflictChoice', resolution(detail, 'edited', { text: marker })), { code: 'Conflict' });
  assert.equal(repo.index.unmerged.length, 3);
  assert.equal(await fileText(repo, 'manual.txt'), 'ours\n');
  const next = await run('conflictDetail', { path: 'manual.txt' });
  await run('resolveConflictChoice', resolution(next, 'edited', { text: 'manually combined\n' }));
  assert.equal(await fileText(repo, 'manual.txt'), 'manually combined\n');
  assert.equal(await objectText(repo, repo.index.get('manual.txt').oid), 'manually combined\n');
  assert.equal(repo.index.unmerged.length, 0);
});

test('resolving rejects stale conflict stages and newer working-file edits', async t => {
  const { repo, run } = await viewFixture(t);
  await conflictStages(repo, 'race.txt', { base: 'base', ours: 'ours', theirs: 'theirs' });
  const detail = await run('conflictDetail', { path: 'race.txt' });
  await repo.worktree.write('race.txt', 'new editor buffer');
  await assert.rejects(run('resolveConflictChoice', resolution(detail, 'ours')), { code: 'Conflict' });
  assert.equal(await fileText(repo, 'race.txt'), 'new editor buffer');
  const changed = await run('conflictDetail', { path: 'race.txt' });
  await conflictStages(repo, 'race.txt', { base: 'base', ours: 'updated ours', theirs: 'theirs' });
  await assert.rejects(run('resolveConflictChoice', resolution(changed, 'theirs')), { code: 'Conflict' });
  assert.equal(await fileText(repo, 'race.txt'), 'updated ours');
  await assert.rejects(run('conflictDetail', { path: '../outside' }), { code: 'NotFound' });
});

test('object database replacement clears session caches and disposes only the current wrapper', async t => {
  const { repo, run } = await viewFixture(t);
  const commit = await commitFile(repo, 'file.txt', 'content\n');
  await run('fileComparison', { path: 'file.txt', commit: commit.oid });
  await repo.graph.walk([commit.oid]);
  const original = repo.odb;
  let disposed = 0;
  const wrapper = { algorithm: repo.algorithm, read: original.read.bind(original), write: original.write.bind(original),
    dispose() { disposed++; } };
  assert.throws(() => repo.replaceObjectDatabase({ ...wrapper, algorithm: 'sha256' }), { code: 'Corrupt' });
  repo.replaceObjectDatabase(wrapper);
  assert.equal(repo.graph.odb, wrapper);
  assert.equal(repo.graph.cache.size, 0);
  assert.equal(repo.graph.generations.size, 0);
  assert.equal(repo.views.entries.size, 0);
  assert.equal((await repo.readCommit(commit.oid)).oid, commit.oid);
  repo.dispose();
  repo.dispose();
  assert.equal(disposed, 1);
});
