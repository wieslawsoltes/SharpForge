import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPorcelainV2 } from '../packages/git/src/index.js';
import { NodeWorktree } from '../packages/git/src/fs/node.js';
import { openService, commitFiles, text } from './git-adjuncts/fixture.js';
import { nativeWorkspace, copyObjects, worktreeRecords } from './a25-conformance-local-fixtures.js';

function indexRows(repo) {
  return repo.index.entries.map(entry => ({ path: entry.path, oid: entry.oid, mode: entry.mode.toString(8),
    stage: entry.stage, skipped: !!entry.skipWorktree }));
}

function nativeIndexRows(bytes) {
  return bytes.toString().split('\0').filter(Boolean).map(row => {
    const match = /^([HS]) ([0-7]+) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/.exec(row);
    assert.ok(match, 'Native sparse index row has a cache/skip tag and stage metadata');
    return { path: match[5], oid: match[3], mode: match[2], stage: Number(match[4]), skipped: match[1] === 'S' };
  });
}

async function sameSparseState(repo, workspace, nativeWorktree) {
  assert.deepEqual(await worktreeRecords(repo.worktree), await worktreeRecords(nativeWorktree));
  assert.deepEqual(indexRows(repo), nativeIndexRows((await workspace.git(['ls-files', '-t', '-s', '-z'])).stdout));
  const native = await workspace.git(['status', '--porcelain=v2', '--untracked-files=all', '-z']);
  assert.equal(formatPorcelainV2(await repo.status(), { nul: true }), native.stdout.toString());
}

// SF-A25-T09.4: actual Git cone checkout is the independent materialization and skip-worktree oracle.
test('cone checkout materialization, index skip bits and status match native Git through selection and disable', async context => {
  const workspace = await nativeWorkspace(context);
  if (!workspace) return;
  const { service, repo } = await openService(context);
  const created = await commitFiles(repo, {
    'README.md': 'root remains visible\n', 'root.bin': Uint8Array.of(0, 255, 7),
    'src/root.txt': 'ancestor file\n', 'src/lib/code.js': 'export const value = 1;\n',
    'src/lib/nested/data.bin': Uint8Array.of(0, 8, 128), 'src/other/excluded.js': 'other source\n',
    'docs/guide.md': 'guide\n', 'docs/deep/manual.md': 'manual\n', 'assets/image.bin': Uint8Array.of(255, 0, 255)
  });
  const tip = created.oid ?? created;
  await workspace.git(['init', '-q', '--initial-branch=main']);
  await copyObjects(repo, workspace.git);
  await workspace.git(['update-ref', 'refs/heads/main', tip]);
  await workspace.git(['read-tree', '--reset', '-u', tip]);
  await workspace.git(['sparse-checkout', 'init', '--cone', '--no-sparse-index']);
  const nativeWorktree = new NodeWorktree(workspace.root);
  for (const directories of [['src/lib'], ['docs'], [], ['src']]) {
    await workspace.git(['sparse-checkout', 'set', '--cone', '--no-sparse-index', '--stdin'],
      { input: directories.length ? directories.join('\n') + '\n' : '' });
    await service.request('configureSparseCheckout', { directories });
    await sameSparseState(repo, workspace, nativeWorktree);
    assert.equal((await repo.status()).length, 0, 'Absent skipped paths must not appear as deletions');
  }
  await repo.worktree.write('src/lib/code.js', text('local edit\n'));
  await workspace.write(workspace.root, 'src/lib/code.js', 'local edit\n');
  await sameSparseState(repo, workspace, nativeWorktree);
  const index = await repo.store.get('index');
  const patterns = await repo.store.get('info/sparse-checkout');
  await assert.rejects(service.request('configureSparseCheckout', { directories: ['docs'] }), { code: 'Conflict' });
  assert.deepEqual(await repo.store.get('index'), index);
  assert.deepEqual(await repo.store.get('info/sparse-checkout'), patterns);
  assert.equal(new TextDecoder().decode((await repo.worktree.read('src/lib/code.js')).data), 'local edit\n');
  await repo.worktree.write('src/lib/code.js', text('export const value = 1;\n'));
  await workspace.write(workspace.root, 'src/lib/code.js', 'export const value = 1;\n');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.request('configureSparseCheckout', { directories: ['docs'] }, { signal: controller.signal }), { code: 'Cancelled' });
  await assert.rejects(service.request('configureSparseCheckout', { directories: ['../outside'] }), { code: 'Unsafe' });
  await workspace.git(['sparse-checkout', 'disable']);
  await service.request('configureSparseCheckout', { disable: true });
  await sameSparseState(repo, workspace, nativeWorktree);
  assert.equal((await service.request('sparseCheckout')).enabled, false);
});
