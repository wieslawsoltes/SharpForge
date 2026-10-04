import test from 'node:test';
import assert from 'node:assert/strict';
import { GitRepository } from '../packages/git/src/repository.js';
import { repository, commitFile } from './a25-workflow-fixtures.js';

test('stat-cache hashes are invalidated when EOL policy or attribute rules change', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  repo.config.set('core.autocrlf', true);
  await commitFile(repo, 'file.txt', 'one\r\ntwo\r\n');
  assert.deepEqual(await repo.status(), []);
  assert.ok(repo.statCache.size);
  repo.config.set('core.autocrlf', false);
  assert.equal((await repo.status()).find(record => record.path === 'file.txt').code, '.M');
  await repo.worktree.write('.gitattributes', '*.txt text eol=lf\n');
  assert.equal((await repo.status()).some(record => record.path === 'file.txt'), false);
});

test('status observes an index persisted by another repository session without discarding CAS guards', async t => {
  const first = await repository();
  t.after(() => first.dispose());
  await commitFile(first, 'file.txt', 'before\n');
  const second = new GitRepository({ odb: first.odb, refs: first.refs, worktree: first.worktree, store: first.store });
  await second.init();
  await first.worktree.write('file.txt', 'after\n');
  await second.add(['file.txt']);
  assert.equal((await first.status())[0].code, 'M.');
  assert.equal(first.index.get('file.txt').oid, second.index.get('file.txt').oid);
});
