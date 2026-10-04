import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, unlink, utimes, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryWorktree } from '../packages/git/src/worktree.js';
import { NodeWorktree } from '../packages/git/src/fs/node-worktree.js';
import { nodeWorktreeIdentity } from '../packages/git/src/fs/node-worktree-stat.js';
import { sameWorktreeStat } from '../packages/git/src/worktree-stat.js';
import { encodeTree } from '../packages/git/src/objects.js';
import { repository, commitFile } from './a25-workflow-fixtures.js';

class CountingWorktree extends MemoryWorktree {
  constructor() {
    super();
    this.contentReads = [];
  }

  async read(path, options) {
    this.contentReads.push(path);
    return super.read(path, options);
  }
}

test('unchanged memory status reads metadata while writes, removals and additions remain visible', async t => {
  const worktree = new CountingWorktree();
  const repo = await repository({ worktree });
  t.after(() => repo.dispose());
  await commitFile(repo, 'one.txt', 'before\n');
  await commitFile(repo, 'two.txt', 'second\n');
  assert.deepEqual(await repo.status(), []);
  worktree.contentReads.length = 0;
  assert.deepEqual(await repo.status(), []);
  assert.deepEqual(worktree.contentReads, []);
  await worktree.write('one.txt', 'after!\n');
  await worktree.remove('two.txt');
  await worktree.write('new.txt', 'new\n');
  const changed = await repo.status();
  assert.deepEqual(changed.map(record => [record.path, record.code]), [
    ['new.txt', '??'], ['one.txt', '.M'], ['two.txt', '.D']
  ]);
  assert.deepEqual(worktree.contentReads.sort(), ['new.txt', 'one.txt']);
  assert.equal(repo.statCache.has('two.txt'), false);
});

test('filesystem status detects same-size writes with restored mtime, chmod and deleted paths', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-status-metadata-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worktree = new NodeWorktree(directory);
  const repo = await repository({ worktree });
  t.after(() => repo.dispose());
  await worktree.write('file.txt', new TextEncoder().encode('before\n'));
  const path = join(directory, 'file.txt');
  await utimes(path, 1700000000, 1700000000);
  await repo.add(['file.txt']);
  await repo.commit({ message: 'baseline' });
  assert.deepEqual(await repo.status(), []);
  assert.deepEqual(await repo.status(), []);
  const before = await lstat(path, { bigint: true });
  await writeFile(path, 'after!\n');
  await utimes(path, 1700000000, 1700000000);
  const after = await lstat(path, { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal((await repo.status())[0].code, '.M');
  await writeFile(path, 'before\n');
  assert.deepEqual(await repo.status(), []);
  if (process.platform !== 'win32') {
    await chmod(path, 0o755);
    assert.equal((await repo.status())[0].worktreeMode, 0o100755);
    repo.config.set('core.filemode', false);
    assert.deepEqual(await repo.status(), []);
  }
  await unlink(path);
  assert.equal((await repo.status())[0].code, '.D');
  await writeFile(join(directory, 'new.txt'), 'untracked\n');
  assert.deepEqual((await repo.status()).map(record => [record.path, record.code]), [
    ['file.txt', '.D'], ['new.txt', '??']
  ]);
});

test('racy filesystem reads cannot become reusable merely because a later scan is older than the timestamp', () => {
  const stat = { dev: 1n, ino: 2n, mode: 0o100644n, size: 7n,
    mtimeNs: 1700000000000000000n, ctimeNs: 1700000000000000000n };
  const during = nodeWorktreeIdentity(stat, 1700000000500000000n);
  const later = nodeWorktreeIdentity(stat, 1700000002000000000n);
  assert.equal(during.cacheable, false);
  assert.equal(later.cacheable, true);
  assert.equal(sameWorktreeStat(during, later), false);
  assert.equal(sameWorktreeStat(later, nodeWorktreeIdentity(stat, 1700000003000000000n)), true);
  const externalWrite = nodeWorktreeIdentity({ ...stat, ctimeNs: 1700000001000000000n }, 1700000004000000000n);
  assert.equal(sameWorktreeStat(later, externalWrite), false);
});

test('cached flattened trees preserve caller isolation, new HEAD and requested entry bounds', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  const first = await commitFile(repo, 'one.txt', 'one\n');
  const original = await repo.readTree('HEAD');
  const expected = original.get('one.txt').oid;
  original.get('one.txt').oid = 'f'.repeat(40);
  original.delete('one.txt');
  assert.equal((await repo.readTree('HEAD')).get('one.txt').oid, expected);
  await commitFile(repo, 'two.txt', 'two\n');
  assert.equal((await repo.readTree('HEAD')).size, 2);
  await assert.rejects(repo.readTree('HEAD', { maxEntries: 2 }), { code: 'Limit' });
  assert.equal((await repo.readTree(first.oid)).size, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(repo.status({ signal: controller.signal }), { code: 'Cancelled' });
});

test('snapshot rule discovery retains nested precedence independently of insertion order', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  await repo.worktree.write('sub/.gitattributes', '*.txt -text\n');
  await repo.worktree.write('sub/.gitignore', '!untracked.txt\n');
  await repo.worktree.write('.gitattributes', '*.txt text eol=lf\n');
  await repo.worktree.write('.gitignore', '*.txt\n');
  await repo.worktree.write('sub/file.txt', 'one\r\ntwo\r\n');
  await repo.add(['.'], { force: true });
  await repo.commit({ message: 'nested rules' });
  const fingerprint = repo.rulesFingerprint;
  assert.deepEqual(await repo.status(), []);
  assert.equal(repo.rulesFingerprint, fingerprint);
  await repo.worktree.write('sub/untracked.txt', 'untracked\n');
  assert.deepEqual((await repo.status()).map(record => [record.path, record.code]), [['sub/untracked.txt', '??']]);
  assert.deepEqual(await repo.diff(), []);
  assert.equal(repo.rulesFingerprint, fingerprint);
});

test('worktree rename choices use path order when identical destinations were inserted in reverse order', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  await commitFile(repo, 'old.txt', 'identical\n');
  await repo.worktree.remove('old.txt');
  await repo.worktree.write('z.txt', 'identical\n');
  await repo.worktree.write('a.txt', 'identical\n');
  await repo.add(['z.txt', 'a.txt'], { intentToAdd: true });
  const changes = await repo.diff({ renames: true });
  assert.deepEqual(changes.map(record => [record.path, record.status, record.oldPath ?? null]), [
    ['a.txt', 'R', 'old.txt'], ['z.txt', 'A', null]
  ]);
});

test('empty tree entry bounds are identical on cold and cached reads', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  const oid = await repo.odb.write('tree', encodeTree([]));
  await assert.rejects(repo.readTree(oid, { maxEntries: 0 }), { code: 'Limit' });
  assert.equal((await repo.readTree(oid, { maxEntries: 1 })).size, 0);
  await assert.rejects(repo.readTree(oid, { maxEntries: 0 }), { code: 'Limit' });
});

test('status compares the actual HEAD when an unrelated tag also has the name HEAD', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  const first = await commitFile(repo, 'file.txt', 'first\n');
  await commitFile(repo, 'file.txt', 'second\n');
  await repo.refs.update('refs/tags/HEAD', first.oid, { expected: null });
  assert.deepEqual(await repo.status(), []);
  await assert.rejects(repo.revParse('HEAD'), { code: 'Conflict' });
});
