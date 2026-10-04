import test from 'node:test';
import assert from 'node:assert/strict';
import { GitViewData } from '../packages/git/src/view-data.js';
import { encodeIndex } from '../packages/git/src/index-file.js';
import { commitFile, fileText, objectText, identity } from './a25-workflow-fixtures.js';
import { viewFixture, comparisonSelection } from './a25-ui-data-fixtures.js';

test('root commit details and historical sources compare with the empty tree without touching open state', async t => {
  const { repo, run } = await viewFixture(t);
  const root = await commitFile(repo, 'Program.cs', 'class Program {}\n');
  await commitFile(repo, 'later.txt', 'later\n');
  await repo.worktree.write('Program.cs', 'class DirtyBuffer {}\n');
  await repo.add(['Program.cs']);
  const beforeIndex = await encodeIndex(repo.index);
  const head = await repo.refs.read('HEAD');
  const detail = await run('commitDetail', { commit: root.oid });
  assert.equal(detail.parent, null);
  assert.deepEqual(detail.files.map(file => [file.status, file.path]), [['A', 'Program.cs']]);
  const compared = await run('historicalFileDiff', { commit: root.oid, path: 'Program.cs' });
  assert.equal(compared.historical, true);
  assert.equal(compared.before.exists, false);
  assert.equal(compared.after.oid, (await repo.readTree(root.oid)).get('Program.cs').oid);
  assert.deepEqual(compared.lines.map(line => [line.type, line.line]), [['insert', 'class Program {}\n']]);
  const sources = await run('comparisonDocuments', { cacheKey: compared.cacheKey });
  assert.equal(sources.before.text, '');
  assert.equal(sources.after.text, 'class Program {}\n');
  assert.equal(await fileText(repo, 'Program.cs'), 'class DirtyBuffer {}\n');
  assert.deepEqual(await encodeIndex(repo.index), beforeIndex);
  assert.equal(await repo.refs.read('HEAD'), head);
});

test('comparison pages preserve stable operation indices and reject expired or oversized pages', async t => {
  const { repo, run } = await viewFixture(t);
  const text = Array.from({ length: 2400 }, (_, index) => `line ${index}\n`).join('');
  const root = await commitFile(repo, 'many.txt', text);
  const first = await run('fileComparison', { path: 'many.txt', commit: root.oid, count: 256 });
  assert.equal(first.total, 2400);
  assert.equal(first.lines.length, 256);
  assert.equal(first.lines[0].newLine, 1);
  const middle = await run('fileComparison', { cacheKey: first.cacheKey, start: 1024, count: 256 });
  assert.equal(middle.lines[0].newLine, 1025);
  assert.equal(middle.lines[0].line, 'line 1024\n');
  const tail = await run('fileComparison', { cacheKey: first.cacheKey, start: 2398, count: 256 });
  assert.equal(tail.lines.length, 2);
  await assert.rejects(run('fileComparison', { cacheKey: first.cacheKey, count: 1001 }), { code: 'Limit' });
  await assert.rejects(run('fileComparison', { cacheKey: first.cacheKey, start: -1 }), { code: 'Limit' });
  await assert.rejects(run('fileComparison', { cacheKey: first.cacheKey, path: 'another.txt' }), { code: 'Conflict' });
  await run('releaseViewData', { cacheKey: first.cacheKey });
  await assert.rejects(run('fileComparison', { cacheKey: first.cacheKey }), { code: 'NotFound' });
});

test('line and hunk staging reject stale comparisons and unstage with the original selection indices', async t => {
  const { repo, run } = await viewFixture(t);
  const before = 'one\nb\nc\nd\ne\nf\ng\nh\ni\nj\nlast\n';
  const after = before.replace('one', 'ONE').replace('last', 'LAST');
  await commitFile(repo, 'file.txt', before);
  await repo.worktree.write('file.txt', after);
  const working = await run('fileComparison', { path: 'file.txt' });
  const anchor = working.lines.find(line => line.hunk);
  const stage = comparisonSelection(working, { hunkStart: anchor.hunk.start });
  await run('stageComparisonSelection', stage);
  assert.equal(await objectText(repo, repo.index.get('file.txt').oid), before.replace('one', 'ONE'));
  assert.equal(await fileText(repo, 'file.txt'), after);
  await assert.rejects(run('stageComparisonSelection', stage), { code: 'Conflict' });
  const staged = await run('fileComparison', { path: 'file.txt', staged: true });
  const selectedLines = staged.lines.flatMap((line, index) => line.type === 'equal' ? [] : [index]);
  await run('stageComparisonSelection', comparisonSelection(staged, { selectedLines }));
  assert.equal(await objectText(repo, repo.index.get('file.txt').oid), before);
  assert.equal(await fileText(repo, 'file.txt'), after);
  const current = await run('fileComparison', { path: 'file.txt' });
  await assert.rejects(run('stageComparisonSelection', comparisonSelection(current, { selectedLines: [] })), { code: 'Conflict' });
  const equal = current.lines.findIndex(line => line.type === 'equal');
  await assert.rejects(run('stageComparisonSelection', comparisonSelection(current, { selectedLines: [equal] })), { code: 'Conflict' });
});

test('reverting a hunk preserves the index and unselected working edits', async t => {
  const { repo, run } = await viewFixture(t);
  const before = 'one\nb\nc\nd\ne\nf\ng\nh\ni\nj\nlast\n';
  const after = before.replace('one', 'ONE').replace('last', 'LAST');
  await commitFile(repo, 'file.txt', before);
  await repo.worktree.write('file.txt', after);
  const index = await encodeIndex(repo.index);
  const compared = await run('fileComparison', { path: 'file.txt' });
  const hunk = compared.lines.find(line => line.hunk).hunk;
  await run('revertComparisonSelection', comparisonSelection(compared, { hunkStart: hunk.start }));
  assert.equal(await fileText(repo, 'file.txt'), before.replace('last', 'LAST'));
  assert.deepEqual(await encodeIndex(repo.index), index);
  await assert.rejects(run('revertComparisonSelection', comparisonSelection(compared, { hunkStart: hunk.start })), { code: 'Conflict' });
});

test('historical rename and merge parent selection use the chosen immutable trees', async t => {
  const { repo, run } = await viewFixture(t);
  const base = await commitFile(repo, 'old.txt', 'unchanged content\n');
  await repo.move('old.txt', 'new.txt');
  const renamed = await repo.commit({ message: 'rename', author: identity, committer: identity });
  const compared = await run('fileComparison', { path: 'new.txt', commit: renamed.oid });
  assert.equal(compared.oldPath, 'old.txt');
  assert.equal(compared.status, 'R');
  assert.equal(compared.before.oid, compared.after.oid);
  const merge = await repo.commit({ message: 'synthetic merge', parents: [renamed.oid, base.oid], allowEmpty: true,
    author: identity, committer: identity });
  const first = await run('commitDetail', { commit: merge.oid, parentIndex: 0 });
  const second = await run('commitDetail', { commit: merge.oid, parentIndex: 1 });
  assert.equal(first.files.length, 0);
  assert.equal(second.files[0].status, 'R');
  await assert.rejects(run('commitDetail', { commit: merge.oid, parentIndex: 2 }), { code: 'Limit' });
});

test('comparison caches enforce capacities, release snapshots and dispose deterministically', () => {
  assert.throws(() => new GitViewData({ maxEntries: 0 }), { code: 'Limit' });
  assert.throws(() => new GitViewData({ maxBytes: -1 }), { code: 'Limit' });
  const cache = new GitViewData({ maxEntries: 1, maxBytes: 1024 });
  const value = { before: { data: new Uint8Array(1) }, after: { data: new Uint8Array(1) }, lines: [] };
  const first = cache.remember(value);
  const second = cache.remember(value);
  assert.throws(() => cache.get(first), { code: 'NotFound' });
  assert.equal(cache.get(second), value);
  cache.dispose();
  assert.equal(cache.bytes, 0);
  assert.throws(() => cache.get(second), { code: 'NotFound' });
});
