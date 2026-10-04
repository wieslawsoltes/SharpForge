import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { diffLines } from '../packages/git/src/diff/lines.js';
import { identity, objectText } from './a25-workflow-fixtures.js';
import { fileTree, commitObject, copyObjects, indexRecords, nativeIndexRecords } from './a25-conformance-local-fixtures.js';
import { workflowFixture, compareWorkflowIndex, compareWorkflowRefs, compareWorkflowReflog } from './a25-conformance-workflow-fixtures.js';

const files = { 'a.txt': 'base\n', 'deleted.txt': 'delete\n', 'folder/child.txt': 'child\n' };
const sameSides = source => ({ base: source, ours: source, theirs: source });

test('native add, update, cached removal, moves, path reset and intent-to-add preserve exact index entries', async t => {
  const cases = [
    ['add', async pair => {
      await pair.write('a.txt', 'modified\n');
      await pair.write('new.txt', 'new\n');
      await pair.git(['add', '--', 'a.txt', 'new.txt']);
      await pair.repo.add(['a.txt', 'new.txt']);
    }],
    ['add-update', async pair => {
      await pair.write('a.txt', 'modified\n');
      await pair.write('untracked.txt', 'not staged\n');
      await pair.remove('deleted.txt');
      await pair.git(['add', '-u', '--', '.']);
      await pair.repo.add(['.'], { update: true });
    }],
    ['cached-remove', async pair => {
      await pair.git(['rm', '--cached', '--', 'a.txt']);
      await pair.repo.remove(['a.txt'], { cached: true });
    }],
    ['move-distinct-index-and-worktree', async pair => {
      await pair.write('a.txt', 'staged\n');
      await pair.git(['add', 'a.txt']);
      await pair.repo.add(['a.txt']);
      await pair.write('a.txt', 'unstaged\n');
      await pair.git(['mv', 'a.txt', 'renamed.txt']);
      await pair.repo.move('a.txt', 'renamed.txt');
    }],
    ['move-directory', async pair => {
      await pair.git(['mv', 'folder', 'relocated']);
      await pair.repo.move('folder', 'relocated');
    }],
    ['reset-paths', async pair => {
      await pair.write('a.txt', 'staged\n');
      await pair.write('new.txt', 'new\n');
      await pair.git(['add', 'a.txt', 'new.txt']);
      await pair.repo.add(['a.txt', 'new.txt']);
      await pair.git(['reset', 'HEAD', '--', 'a.txt', 'new.txt']);
      await pair.repo.reset('HEAD', { paths: ['a.txt', 'new.txt'] });
    }],
    ['intent-to-add', async pair => {
      await pair.write('pending.txt', 'intent content\n');
      await pair.git(['add', '-N', '--', 'pending.txt']);
      await pair.repo.add(['pending.txt'], { intentToAdd: true });
    }]
  ];
  for (const [name, action] of cases) await t.test(name, async context => {
    const pair = await workflowFixture(context, name, sameSides(files));
    if (!pair) return;
    await action(pair);
    await compareWorkflowIndex(pair, name);
  });
});

test('native rejected staging operations leave index and worktree unchanged', async t => {
  const pair = await workflowFixture(t, 'rejected', sameSides(files));
  if (!pair) return;
  assert.notEqual((await pair.git(['add', '--', 'missing.txt'], { allowFailure: true })).code, 0);
  await assert.rejects(pair.repo.add(['missing.txt']), { code: 'NotFound' });
  await pair.write('a.txt', 'staged\n');
  await pair.git(['add', 'a.txt']);
  await pair.repo.add(['a.txt']);
  await pair.write('a.txt', 'unstaged\n');
  assert.notEqual((await pair.git(['rm', '--cached', '--', 'a.txt'], { allowFailure: true })).code, 0);
  await assert.rejects(pair.repo.remove(['a.txt'], { cached: true }), { code: 'Conflict' });
  assert.notEqual((await pair.git(['mv', 'a.txt', 'deleted.txt'], { allowFailure: true })).code, 0);
  await assert.rejects(pair.repo.move('a.txt', 'deleted.txt'), { code: 'Conflict' });
  await compareWorkflowIndex(pair, 'rejected commands');
});

test('native soft, mixed and hard reset preserve their exact index, worktree and ORIG_HEAD scope', async t => {
  for (const mode of ['soft', 'mixed', 'hard']) await t.test(mode, async context => {
    const pair = await workflowFixture(context, `reset-${mode}`, {
      base: { 'a.txt': 'base\n' }, ours: { 'a.txt': 'committed\n' }, theirs: { 'a.txt': 'base\n' }
    });
    if (!pair) return;
    await pair.write('a.txt', 'staged\n');
    await pair.git(['add', 'a.txt']);
    await pair.repo.add(['a.txt']);
    await pair.write('a.txt', 'working\n');
    await pair.write('untracked.txt', 'preserved\n');
    await pair.git(['reset', `--${mode}`, 'HEAD^']);
    await pair.repo.reset('HEAD^', { mode });
    await compareWorkflowIndex(pair, `${mode} reset`);
    assert.equal(await pair.repo.refs.read('ORIG_HEAD'), (await pair.git(['rev-parse', 'ORIG_HEAD'])).text);
  });
});

test('scripted native add -p stages one line within the middle of three hunks and reverses it', async t => {
  const source = Array.from({ length: 90 }, (_, index) => `line ${index}\n`);
  const before = source.join('');
  const after = source.map((line, index) => (index === 5 ? 'first-hunk\n' : index === 45
    ? 'middle-selected\nmiddle-not-selected\n' : index === 85 ? 'third-hunk\n' : '') + line).join('');
  const pair = await workflowFixture(t, 'partial', sameSides({ 'file.txt': before }));
  if (!pair) return;
  await pair.write('file.txt', after);
  assert.equal((await pair.git(['diff', '--no-ext-diff', '--unified=3'])).text.match(/^@@ /gm)?.length, 3);
  const quote = value => `'${value.replace(/'/g, "'\\''")}'`;
  const editor = fileURLToPath(new URL('./a25-conformance-patch-editor.mjs', import.meta.url));
  await pair.git(['-c', 'color.ui=false', '-c', 'interactive.singleKey=false', 'add', '-p', '--', 'file.txt'], {
    input: 'n\ne\nn\n', env: { GIT_EDITOR: `${quote(process.execPath)} ${quote(editor)}` }
  });
  const changes = diffLines(before, after);
  const selected = changes.findIndex(line => line.type === 'insert' && line.line === 'middle-selected\n');
  assert.ok(selected >= 0);
  await pair.repo.stagePatch('file.txt', { before, after, selectedLines: [selected] });
  await compareWorkflowIndex(pair, 'single selected line');
  const staged = await objectText(pair.repo, pair.repo.index.get('file.txt').oid);
  assert.equal(staged, (await pair.git(['show', ':file.txt'])).stdout.toString());
  assert.match(staged, /middle-selected/u);
  assert.doesNotMatch(staged, /first-hunk|middle-not-selected|third-hunk/u);
  await pair.git(['-c', 'interactive.singleKey=false', 'reset', '-p', 'HEAD', '--', 'file.txt'], { input: 'y\n' });
  const stagedLines = diffLines(before, staged);
  await pair.repo.stagePatch('file.txt', { before, after: staged,
    selectedLines: [stagedLines.findIndex(line => line.type === 'insert')] }, { reverse: true });
  await compareWorkflowIndex(pair, 'reverse selected line');
});

test('native branch, upstream, annotated tag and reflog mutations match with deterministic identities', async t => {
  const pair = await workflowFixture(t, 'refs', sameSides(files));
  if (!pair) return;
  const settings = { identity, timestamp: identity.timestamp, timezone: identity.timezone };
  await pair.git(['branch', 'feature', 'HEAD^']);
  await pair.repo.branch('feature', { start: 'HEAD^', ...settings });
  await t.test('created refs and reflog', async () => {
    await compareWorkflowRefs(pair, 'create branch');
    await compareWorkflowReflog(pair, 'refs/heads/feature', 'create branch');
  });
  assert.notEqual((await pair.git(['branch', 'feature'], { allowFailure: true })).code, 0);
  await assert.rejects(pair.repo.branch('feature', settings), { code: 'Conflict' });
  await pair.git(['branch', '-m', 'feature', 'renamed']);
  await pair.repo.branch('feature', { rename: 'renamed', ...settings });
  await t.test('renamed refs and reflogs', async () => {
    await compareWorkflowRefs(pair, 'rename branch');
    await compareWorkflowReflog(pair, 'refs/heads/renamed', 'rename branch');
    await compareWorkflowReflog(pair, 'refs/heads/feature', 'renamed source removed');
  });
  await pair.git(['config', 'remote.origin.url', 'https://example.invalid/repository.git']);
  await pair.git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*']);
  pair.repo.config.set('remote.origin.url', 'https://example.invalid/repository.git');
  pair.repo.config.set('remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
  await pair.repo.config.save();
  await pair.git(['update-ref', '-m', 'fixture tracking ref', 'refs/remotes/origin/main', pair.ours]);
  await pair.repo.refs.update('refs/remotes/origin/main', pair.ours, { expected: null, identity, message: 'fixture tracking ref' });
  await t.test('tracking ref reflog', () => compareWorkflowReflog(pair, 'refs/remotes/origin/main', 'tracking ref'));
  await pair.git(['branch', '--track', 'tracking', 'refs/remotes/origin/main']);
  await pair.repo.branch('tracking', { start: 'refs/remotes/origin/main', upstream: { remote: 'origin', merge: 'refs/heads/main' }, ...settings });
  await t.test('upstream refs and configuration', async () => {
    await compareWorkflowRefs(pair, 'upstream branch');
    await compareWorkflowReflog(pair, 'refs/heads/tracking', 'upstream branch');
    for (const key of ['branch.tracking.remote', 'branch.tracking.merge']) {
      assert.equal(pair.repo.config.get(key), (await pair.git(['config', key])).text);
    }
  });
  await pair.git(['tag', 'lightweight', 'HEAD']);
  await pair.repo.tag('lightweight');
  await pair.git(['tag', '-a', 'release', '-m', 'annotated release', 'HEAD']);
  await pair.repo.tag('release', { message: 'annotated release', tagger: identity });
  await t.test('annotated and lightweight tag refs', () => compareWorkflowRefs(pair, 'tags'));
  for (const name of ['lightweight', 'release']) await t.test(`${name} default tag reflog`, () =>
    compareWorkflowReflog(pair, `refs/tags/${name}`, 'default tag reflog policy'));
  await pair.git(['branch', '-d', 'renamed']);
  await pair.repo.branch('renamed', { delete: true, ...settings });
  await t.test('deleted branch reflog', () => compareWorkflowReflog(pair, 'refs/heads/renamed', 'deleted merged branch'));
  assert.notEqual((await pair.git(['branch', '-d', 'topic'], { allowFailure: true })).code, 0);
  await assert.rejects(pair.repo.branch('topic', { delete: true }), { code: 'Conflict' });
  await pair.git(['branch', '-D', 'topic']);
  await pair.repo.branch('topic', { delete: true, force: true });
  await pair.git(['tag', '-d', 'lightweight', 'release']);
  await pair.repo.tag('lightweight', { delete: true });
  await pair.repo.tag('release', { delete: true });
  await t.test('deleted refs', () => compareWorkflowRefs(pair, 'delete refs'));
  await t.test('forced branch deletion reflog', () => compareWorkflowReflog(pair, 'refs/heads/topic', 'forced branch deletion'));
});

test('native cherry-pick and revert produce equal trees through clean and conflicted replay', async t => {
  const cases = [
    { name: 'pick-clean', method: 'cherryPick', command: 'cherry-pick', base: { file: 'base\n' },
      ours: { file: 'base\n', keep: 'ours\n' }, theirs: { file: 'incoming\n', added: 'new\n' } },
    { name: 'pick-conflict', method: 'cherryPick', command: 'cherry-pick', base: { file: 'base\n' },
      ours: { file: 'ours\n' }, theirs: { file: 'theirs\n' } },
    { name: 'revert-clean', method: 'revert', command: 'revert', base: { file: 'base\n' },
      ours: { file: 'incoming\n', added: 'new\n', keep: 'ours\n' }, theirs: { file: 'incoming\n', added: 'new\n' } },
    { name: 'revert-conflict', method: 'revert', command: 'revert', base: { file: 'base\n' },
      ours: { file: 'later\n' }, theirs: { file: 'incoming\n' } }
  ];
  for (const fixture of cases) await t.test(fixture.name, async context => {
    const pair = await workflowFixture(context, fixture.name, fixture);
    if (!pair) return;
    const native = await pair.git([fixture.command, '--no-edit', pair.theirs], { allowFailure: true });
    assert.ok(native.code === 0 || native.code === 1, native.stderr.toString());
    const actual = await pair.repo[fixture.method](pair.theirs, { author: identity, committer: identity });
    assert.equal(actual.status === 'conflicted', native.code === 1);
    assert.deepEqual(indexRecords(pair.repo.index), nativeIndexRecords((await pair.git(['ls-files', '--stage', '-z'])).stdout));
    if (native.code === 1) {
      const ref = fixture.method === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD';
      assert.equal((await pair.repo.readState(ref)).oid, (await pair.git(['rev-parse', ref])).text);
      await pair.write('file', 'resolved identically\n');
      await pair.git(['add', 'file']);
      await pair.repo.add(['file']);
      await pair.git([fixture.command, '--continue'], { env: { GIT_EDITOR: ':' } });
      await pair.repo[fixture.method](null, { action: 'continue', author: identity, committer: identity });
    }
    assert.equal(await pair.repo.writeTree(), (await pair.git(['rev-parse', 'HEAD^{tree}'])).text);
    await compareWorkflowIndex(pair, fixture.name, { head: false });
  });
});

test('native range replay and merge mainline selection use the same ordered changes', async t => {
  for (const method of ['cherryPick', 'revert']) await t.test(method, async context => {
    const before = 'base\n';
    const middle = 'base\nfirst\n';
    const after = 'base\nfirst\nsecond\n';
    const pair = await workflowFixture(context, `range-${method}`, { base: { file: before },
      ours: { file: method === 'revert' ? after : before, keep: 'ours\n' }, theirs: { file: middle } });
    if (!pair) return;
    const base = (await pair.repo.readCommit(pair.theirs)).parents[0];
    const tree = await fileTree(pair.repo, { file: after });
    const tip = await commitObject(pair.repo, tree.oid, [pair.theirs], 'second change');
    await copyObjects(pair.repo, pair.git);
    const revision = `${base}..${tip}`;
    await pair.git([method === 'revert' ? 'revert' : 'cherry-pick', '--no-edit', revision]);
    const result = await pair.repo[method](revision, { author: identity, committer: identity });
    assert.equal(result.status, 'completed');
    assert.equal(await pair.repo.writeTree(), (await pair.git(['rev-parse', 'HEAD^{tree}'])).text);
    await compareWorkflowIndex(pair, `${method} range`, { head: false });
  });
  await t.test('merge mainline', async context => {
    const pair = await workflowFixture(context, 'mainline', { base: { file: 'base\n' },
      ours: { file: 'base\n', keep: 'ours\n' }, theirs: { file: 'incoming\n' } });
    if (!pair) return;
    const base = (await pair.repo.readCommit(pair.theirs)).parents[0];
    const tree = await fileTree(pair.repo, { file: 'incoming\n', merged: 'merge result\n' });
    const merge = await commitObject(pair.repo, tree.oid, [base, pair.theirs], 'merge fixture');
    await copyObjects(pair.repo, pair.git);
    assert.notEqual((await pair.git(['cherry-pick', merge], { allowFailure: true })).code, 0);
    await assert.rejects(pair.repo.cherryPick(merge, { committer: identity }), { code: 'Conflict' });
    await pair.repo.cherryPick(null, { abort: true });
    await pair.git(['cherry-pick', '--no-edit', '-m', '1', merge]);
    await pair.repo.cherryPick(merge, { mainline: 1, author: identity, committer: identity });
    assert.equal(await pair.repo.writeTree(), (await pair.git(['rev-parse', 'HEAD^{tree}'])).text);
    await compareWorkflowIndex(pair, 'merge mainline', { head: false });
  });
});
