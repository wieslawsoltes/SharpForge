import test from 'node:test';
import assert from 'node:assert/strict';
import { CommitGraph } from '../packages/git/src/graph.js';
import { encodeCommit } from '../packages/git/src/objects.js';
import { repository, identity } from './a25-workflow-fixtures.js';
import { commitObject } from './a25-conformance-local-fixtures.js';

test('generation-assisted merge-base prunes old ancestry after the generation cache is populated', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  const tree = await repo.writeTree();
  let current = await commitObject(repo, tree, [], 'root');
  for (let index = 0; index < 200; index++) current = await commitObject(repo, tree, [current], `old history ${index}`);
  const base = current;
  let left = base;
  let right = base;
  for (let index = 0; index < 3; index++) {
    left = await commitObject(repo, tree, [left], `left ${index}`);
    right = await commitObject(repo, tree, [right], `right ${index}`);
  }
  let reads = 0;
  const graph = new CommitGraph({ odb: { async read(...args) { reads++; return repo.odb.read(...args); } } });
  await graph.ensureGenerations([left, right]);
  assert.equal(graph.generations.get(base), 201);
  assert.equal(graph.generations.get(left), 204);
  graph.cache.clear();
  reads = 0;
  let progress;
  assert.deepEqual(await graph.mergeBases(left, right, { onProgress: value => { progress = value; } }), [base]);
  assert.ok(reads <= 7, `Only branch tips and the common base should be read, observed ${reads}`);
  assert.equal(progress.visited, 7);
  assert.equal(await graph.isAncestor(base, left), true);
});

test('generation merge-base returns every criss-cross best ancestor and excludes redundant older commits', async t => {
  const repo = await repository();
  t.after(() => repo.dispose());
  const tree = await repo.writeTree();
  const root = await commitObject(repo, tree, [], 'root');
  const first = await commitObject(repo, tree, [root], 'first');
  const second = await commitObject(repo, tree, [root], 'second');
  const left = await commitObject(repo, tree, [first, second], 'left merge');
  const right = await commitObject(repo, tree, [second, first], 'right merge');
  assert.deepEqual(await repo.graph.mergeBases(left, right), [first, second].sort());
  assert.deepEqual(await repo.graph.mergeBases(first, left), [first]);
  const unrelated = await commitObject(repo, tree, [], 'unrelated');
  assert.deepEqual(await repo.graph.mergeBases(left, unrelated), []);
});

test('generation computation rejects cycles, exceeded bounds and cancelled queries', async () => {
  const left = 'a'.repeat(40);
  const right = 'b'.repeat(40);
  const tree = 'c'.repeat(40);
  const record = parents => ({ type: 'commit', data: encodeCommit({ tree, parents, author: identity, committer: identity, message: 'cycle\n' }) });
  const graph = new CommitGraph({ odb: { read: async oid => record([oid === left ? right : left]) } });
  await assert.rejects(graph.ensureGenerations([left]), { code: 'Corrupt' });
  const bounded = new CommitGraph({ odb: { read: async oid => record(oid === left ? [right] : []) } });
  await assert.rejects(bounded.ensureGenerations([left], { maxCommits: 1 }), { code: 'Limit' });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(bounded.mergeBases(left, left, { signal: cancelled.signal }), { code: 'Cancelled' });
  await assert.rejects(bounded.isAncestor(left, left, { signal: cancelled.signal }), { code: 'Cancelled' });
});
