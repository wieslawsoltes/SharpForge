import test from 'node:test';
import assert from 'node:assert/strict';
import { unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { GitRepository } from '../packages/git/src/repository.js';
import { openNodeRepository } from '../packages/git/src/fs/node.js';
import { formatPorcelainV2 } from '../packages/git/src/status.js';
import { repository } from './a25-workflow-fixtures.js';
import { nativeWorkspace, fileTree, commitObject, copyObjects } from './a25-conformance-local-fixtures.js';

test('native porcelain v2 agrees on staged, unstaged, rename, mode, deletion and untracked files', async t => {
  const workspace = await nativeWorkspace(t);
  if (!workspace) return;
  await workspace.git(['init', '-q', '-b', 'main']);
  const source = await repository();
  t.after(() => source.dispose());
  const tree = await fileTree(source, { 'modified.txt': 'before\n', 'staged.txt': 'before\n', 'deleted.txt': 'delete\n',
    'missing.txt': 'missing\n', 'rename.txt': 'rename content\n', 'mode.txt': 'mode\n', 'kind.txt': 'regular\n' });
  const base = await commitObject(source, tree.oid, [], 'base');
  await copyObjects(source, workspace.git);
  await workspace.git(['update-ref', 'refs/heads/main', base]);
  await workspace.git(['read-tree', '--reset', '-u', base]);
  await workspace.write(workspace.root, 'modified.txt', 'changed\n');
  await workspace.write(workspace.root, 'staged.txt', 'staged\n');
  await workspace.write(workspace.root, 'added.txt', 'new\n');
  await workspace.write(workspace.root, 'untracked/fresh.txt', 'untracked\n');
  await workspace.git(['add', 'staged.txt', 'added.txt']);
  await workspace.write(workspace.root, 'staged.txt', 'staged and working\n');
  await workspace.git(['mv', 'rename.txt', 'renamed.txt']);
  await workspace.git(['rm', '-q', 'deleted.txt']);
  await workspace.git(['update-index', '--chmod=+x', 'mode.txt']);
  await unlink(join(workspace.root, 'missing.txt'));
  if (process.platform !== 'win32') {
    await unlink(join(workspace.root, 'kind.txt'));
    await symlink('target', join(workspace.root, 'kind.txt'));
    await workspace.git(['add', 'kind.txt']);
  } else t.diagnostic('Windows symlink privilege cell is explicitly excluded; other status cells run');
  const opened = await openNodeRepository({ directory: workspace.root });
  const repo = new GitRepository(opened);
  await repo.init();
  t.after(async () => { repo.dispose(); await opened.store.close(); });
  const records = await repo.status();
  for (const nul of [false, true]) {
    const native = await workspace.git(['status', '--porcelain=v2', '--untracked-files=all', ...(nul ? ['-z'] : [])]);
    assert.equal(formatPorcelainV2(records, { nul }), native.stdout.toString('utf8'));
  }
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(repo.status({ signal: cancelled.signal }), { code: 'Cancelled' });
});
