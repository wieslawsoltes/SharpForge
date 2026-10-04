import test from 'node:test';
import assert from 'node:assert/strict';
import { treeDiff, formatNameStatus } from '../packages/git/src/diff/tree.js';
import { repository } from './a25-workflow-fixtures.js';
import { nativeWorkspace, fileTree, copyObjects } from './a25-conformance-local-fixtures.js';

async function compare(t, workspace, before, after, options = {}) {
  const repo = await repository();
  t.after(() => repo.dispose());
  const left = await fileTree(repo, before);
  const right = await fileTree(repo, after);
  await copyObjects(repo, workspace.git);
  const threshold = options.renameThreshold ?? 50;
  const native = await workspace.git(['diff', '--no-ext-diff', '--name-status', `-M${threshold}%`,
    ...(options.nul ? ['-z'] : []), left.oid, right.oid, '--', ...(options.pathspec ?? [])]);
  const actual = await treeDiff(repo, await repo.readTree(left.oid), await repo.readTree(right.oid), options);
  assert.equal(formatNameStatus(actual, options), native.stdout.toString('utf8'), JSON.stringify(options));
  return actual;
}

test('native name-status -M matches exact rename similarity thresholds and three-digit scores', { timeout: 180000 }, async t => {
  const workspace = await nativeWorkspace(t);
  if (!workspace) return;
  await workspace.git(['init', '-q', '-b', 'main']);
  const original = Array.from({ length: 100 }, (_, index) => `line-${String(index).padStart(3, '0')}-old\n`);
  for (const common of [0, 1, 24, 49, 50, 51, 75, 98, 100]) {
    const modified = original.map((line, index) => index < common ? line : line.replace('-old', '-new')).join('');
    for (const threshold of [25, 50, 75, 100]) {
      await t.test(`common-${common}-threshold-${threshold}`, async context => {
        await compare(context, workspace, { 'old.txt': original.join('') }, { 'new.txt': modified }, { renameThreshold: threshold });
      });
    }
  }
  t.diagnostic('36 independent native similarity threshold comparisons');
});

test('name-status preserves pathspec order, C quoting, type changes, modes and NUL names', async t => {
  const workspace = await nativeWorkspace(t);
  if (!workspace) return;
  await workspace.git(['init', '-q', '-b', 'main']);
  const before = { 'old.txt': 'rename\n', 'modified.txt': 'before\n', 'deleted.txt': 'gone\n',
    'mode.txt': 'unchanged\n', 'kind.txt': 'regular\n', 'folder/other.txt': 'old\n' };
  const after = { 'new.txt': 'rename\n', 'modified.txt': 'after\n', 'mode.txt': { data: 'unchanged\n', mode: 0o100755 },
    'kind.txt': { data: 'target', mode: 0o120000 }, 'folder/other.txt': 'new\n', 'with space.txt': 'space\n',
    'with\ttab.txt': 'tab\n', 'with\nnewline.txt': 'newline\n', 'é.txt': 'unicode\n' };
  for (const options of [{}, { nul: true }, { pathspec: ['new.txt'] }, { pathspec: ['old.txt'] },
    { pathspec: [':(glob)**/*.txt', ':(exclude)folder/**'] }, { pathspec: [':(literal)with\ttab.txt'] }]) {
    await compare(t, workspace, before, after, options);
  }
});
