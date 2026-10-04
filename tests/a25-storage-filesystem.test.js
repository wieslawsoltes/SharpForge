import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initNodeRepository, openNodeRepository, NodeFileStore, NodeWorktree } from '../packages/git/src/fs/node.js';
import { GitRepository } from '../packages/git/src/repository.js';
import { addPaths } from '../packages/git/src/stage.js';
import { createCommit } from '../packages/git/src/commit.js';
import { encodeTree, encodeCommit } from '../packages/git/src/objects.js';

const encode = text => new TextEncoder().encode(text);
const identity = { name: 'Storage Fixture', email: 'storage@example.test', timestamp: 1700000000, timezone: '+0000' };

function nativeGit(directory, args, input) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', input,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(directory, 'no-global-config'),
      GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email, GIT_AUTHOR_DATE: '1700000000 +0000', GIT_COMMITTER_DATE: '1700000000 +0000' } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trimEnd();
}

function requireGit(t) {
  const result = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) { t.skip('Native Git is unavailable on this platform'); return false; }
  t.diagnostic(result.stdout.trim());
  return true;
}

test('native clone opens with clean status and a library-created commit appears in git log', async t => {
  if (!requireGit(t)) return;
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-git-native-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const clone = join(root, 'clone');
  await mkdir(source);
  nativeGit(source, ['init', '--quiet', '--initial-branch=main']);
  await writeFile(join(source, 'hello.txt'), 'from command-line git\n');
  nativeGit(source, ['add', 'hello.txt']);
  nativeGit(source, ['commit', '--quiet', '-m', 'Native initial commit']);
  nativeGit(root, ['clone', '--quiet', '--no-local', source, clone]);
  nativeGit(clone, ['gc', '--quiet', '--prune=now']);
  const nativeHead = nativeGit(clone, ['rev-parse', 'HEAD']);
  const descriptor = await openNodeRepository({ directory: clone });
  t.after(() => descriptor.odb.close());
  assert.equal(await descriptor.refs.read('HEAD'), nativeHead);
  assert.equal((await descriptor.odb.read(nativeHead)).type, 'commit');
  assert.ok((await descriptor.store.listPacks()).length > 0);
  const repo = new GitRepository(descriptor);
  await repo.loadIndex();
  assert.deepEqual(await repo.status(), []);
  await descriptor.worktree.write('hello.txt', encode('committed by SharpForge\n'));
  assert.equal((await repo.status()).find(record => record.path === 'hello.txt').worktreeStatus, 'M');
  await addPaths(repo, ['hello.txt']);
  const result = await createCommit(repo, { message: 'Commit from SharpForge', author: identity, committer: identity });
  assert.equal(nativeGit(clone, ['rev-parse', 'HEAD']), result.oid);
  assert.equal(nativeGit(clone, ['log', '-1', '--format=%s']), 'Commit from SharpForge');
  assert.equal(nativeGit(clone, ['show', 'HEAD:hello.txt']), 'committed by SharpForge');
  assert.equal(nativeGit(clone, ['status', '--porcelain']), '');
});

for (const algorithm of ['sha1', 'sha256']) {
  test(`initialized ${algorithm} filesystem metadata and objects are readable by native git`, async t => {
    if (!requireGit(t)) return;
    const root = await mkdtemp(join(tmpdir(), `sharpforge-git-${algorithm}-`));
    t.after(() => rm(root, { recursive: true, force: true }));
    const repo = await initNodeRepository({ directory: root, algorithm });
    t.after(() => repo.odb.close());
    const blob = await repo.odb.write('blob', encode('native format\n'));
    assert.equal(nativeGit(root, ['hash-object', '--stdin'], 'native format\n'), blob);
    const tree = await repo.odb.write('tree', encodeTree([{ name: 'file.txt', mode: 0o100644, oid: blob }], { algorithm }));
    const commit = await repo.odb.write('commit', encodeCommit({ tree, author: identity, committer: identity,
      message: 'Native-readable metadata\n' }, { algorithm }));
    await repo.refs.update('HEAD', commit, { expected: null, identity, message: 'commit: Native-readable metadata' });
    assert.equal(nativeGit(root, ['log', '-1', '--format=%s']), 'Native-readable metadata');
    assert.equal(nativeGit(root, ['cat-file', '-p', blob]), 'native format');
    assert.equal(nativeGit(root, ['rev-parse', '--show-object-format']), algorithm);
    await assert.rejects(initNodeRepository({ directory: root }), { code: 'Conflict' });
  });
}

test('native reference locks reject concurrent CLI writers without partial refs or reflogs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-git-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = await initNodeRepository({ directory: root });
  const oid = '1'.repeat(40);
  await repo.refs.update('HEAD', oid, { expected: null, identity });
  const before = await repo.refs.reflog();
  await writeFile(join(root, '.git', 'refs', 'heads', 'main.lock'), 'other writer');
  await assert.rejects(repo.refs.update('HEAD', '2'.repeat(40), { expected: oid, identity }), { code: 'Conflict' });
  assert.equal(await repo.refs.read('HEAD'), oid);
  assert.deepEqual(await repo.refs.reflog(), before);
  assert.equal(await readFile(join(root, '.git', 'refs', 'heads', 'main.lock'), 'utf8'), 'other writer');
});

test('Node storage and worktree reject traversal while preserving executable and safe symlink modes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sharpforge-git-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = new NodeWorktree(root);
  await assert.rejects(worktree.write('../outside', encode('bad')), { code: 'Unsafe' });
  await assert.rejects(worktree.write('.git/config', encode('bad')), { code: 'Unsafe' });
  await worktree.write('bin/script.sh', encode('#!/bin/sh\n'), { mode: 0o100755 });
  if (process.platform !== 'win32') assert.equal((await worktree.read('bin/script.sh')).mode, 0o100755);
  if (process.platform !== 'win32') {
    await worktree.write('script-link', encode('bin/script.sh'), { mode: 0o120000 });
    assert.equal((await worktree.read('script-link')).mode, 0o120000);
    await assert.rejects(worktree.write('outside-link', encode('../outside'), { mode: 0o120000 }), { code: 'Unsafe' });
    await symlink(root, join(root, 'escape'));
    await assert.rejects(worktree.write('escape/evil', encode('bad')), { code: 'Unsafe' });
    const store = new NodeFileStore({ directory: root });
    await assert.rejects(store.get('script-link'), { code: 'Unsafe' });
    await assert.rejects(store.set('escape/metadata', encode('bad')), { code: 'Unsafe' });
  }
  await worktree.remove('bin/script.sh');
  assert.equal(await worktree.read('bin/script.sh'), null);
});
