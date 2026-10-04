import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeWorkspace, mergeFixture, indexRecords, nativeIndexRecords, worktreeRecords } from './a25-conformance-local-fixtures.js';

const unchanged = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n';
const binary = value => new Uint8Array([0, value, 255]);
const executable = data => ({ data, mode: 0o100755 });
const symlink = data => ({ data, mode: 0o120000 });

const cases = [
  { name: 'content', base: { file: 'base\n' }, ours: { file: 'ours\n' }, theirs: { file: 'theirs\n' } },
  { name: 'add-add', base: {}, ours: { file: 'ours\n' }, theirs: { file: 'theirs\n' } },
  { name: 'modify-delete', base: { file: 'base\n' }, ours: { file: 'ours\n' }, theirs: {} },
  { name: 'rename-rename', base: { old: unchanged }, ours: { left: unchanged }, theirs: { right: unchanged } },
  { name: 'rename-rename-collision', base: { first: 'first\n', second: 'second\n' },
    ours: { merged: 'first\n', second: 'second\n' }, theirs: { first: 'first\n', merged: 'second\n' } },
  { name: 'rename-delete', base: { old: unchanged }, ours: { renamed: unchanged }, theirs: {} },
  { name: 'rename-add', base: { old: unchanged }, ours: { renamed: unchanged }, theirs: { old: unchanged, renamed: 'addition\n' } },
  { name: 'directory-file', base: {}, ours: { path: 'file\n' }, theirs: { 'path/child': 'child\n' } },
  { name: 'directory-file-modified', base: { path: 'base\n' }, ours: { path: 'modified\n' }, theirs: { 'path/child': 'child\n' } },
  { name: 'binary', base: { file: binary(1) }, ours: { file: binary(2) }, theirs: { file: binary(3) } },
  { name: 'mode-content', base: { file: unchanged }, ours: { file: executable(unchanged) }, theirs: { file: unchanged.replace('two', 'TWO') } },
  { name: 'delete-delete', base: { file: unchanged }, ours: {}, theirs: {} },
  { name: 'independent', base: { file: unchanged }, ours: { file: unchanged.replace('one', 'ONE') },
    theirs: { file: unchanged.replace('seven', 'SEVEN') } },
  { name: 'same-edit', base: { file: unchanged }, ours: { file: unchanged.replace('two', 'TWO') },
    theirs: { file: unchanged.replace('two', 'TWO') } },
  { name: 'symlink', base: { file: symlink('old') }, ours: { file: symlink('left') }, theirs: { file: symlink('right') }, symlinks: true },
  { name: 'type-change', base: { file: unchanged }, ours: { file: 'modified\n' }, theirs: { file: symlink('target') }, symlinks: true },
  { name: 'add-mode', base: {}, ours: { file: executable(unchanged) }, theirs: { file: unchanged } }
];

test('native merge matrix preserves exact index stages and working-file results in both directions', { timeout: 240000 }, async t => {
  const workspace = await nativeWorkspace(t);
  if (!workspace) return;
  let verified = 0;
  for (const fixture of cases) {
    for (const reverse of [false, true]) {
      const name = `${fixture.name}${reverse ? '-reverse' : ''}`;
      await t.test(name, { skip: fixture.symlinks && process.platform === 'win32'
        ? 'Windows symlink creation requires platform privileges; Unix symlink cells remain authoritative' : false }, async context => {
        const sides = reverse ? { base: fixture.base, ours: fixture.theirs, theirs: fixture.ours } : fixture;
        const { repo, git, nativeWorktree, theirs } = await mergeFixture(workspace, name, sides);
        context.after(() => repo.dispose());
        const native = await git(['merge', '--no-ff', '--no-commit', 'topic'], { allowFailure: true });
        assert.ok(native.code === 0 || native.code === 1, native.stderr.toString());
        const actual = await repo.merge('topic', { noCommit: true });
        assert.equal(actual.status === 'conflicted', native.code === 1, `${name} conflict decision`);
        assert.deepEqual(indexRecords(repo.index), nativeIndexRecords((await git(['ls-files', '--stage', '-z'])).stdout), `${name} index`);
        assert.deepEqual(await worktreeRecords(repo.worktree), await worktreeRecords(nativeWorktree), `${name} working bytes`);
        assert.deepEqual((await repo.readState('MERGE_HEAD')).oids, [theirs]);
        assert.equal((await git(['rev-parse', 'MERGE_HEAD'])).text, theirs);
        verified++;
      });
    }
  }
  t.diagnostic(JSON.stringify({ scenarios: cases.length * 2, verified, platform: process.platform, reference: 'git merge --no-commit' }));
});
