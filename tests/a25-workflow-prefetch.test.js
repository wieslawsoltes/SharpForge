import test from 'node:test';
import assert from 'node:assert/strict';
import { PromisorDatabase } from '../packages/git/src/promisor.js';
import { planCheckout } from '../packages/git/src/checkout.js';
import { repository } from './a25-workflow-fixtures.js';
import { fileTree, commitObject } from './a25-conformance-local-fixtures.js';

async function partial(t) {
  const remote = await repository();
  const repo = await repository();
  t.after(() => { repo.dispose(); remote.dispose(); });
  const files = {};
  for (let index = 0; index < 100; index++) files[`file-${index}.txt`] = `unique promised content ${index}\n`;
  const tree = await fileTree(remote, files);
  const commit = await commitObject(remote, tree.oid, [], 'partial fixture');
  for (const oid of await remote.odb.list()) {
    const object = await remote.odb.read(oid);
    if (object.type !== 'blob') await repo.odb.write(object.type, object.data);
  }
  const local = repo.odb;
  const batches = [];
  const promisor = new PromisorDatabase({ odb: local, maxBatch: 128, fetchObjects: async oids => {
    batches.push([...oids]);
    for (const oid of oids) {
      const object = await remote.odb.read(oid);
      await local.write(object.type, object.data);
    }
  } });
  repo.replaceObjectDatabase(promisor);
  return { repo, local, remote, batches, commit, tree };
}

test('checkout batches all missing target blobs before sequential materialization', async t => {
  const { repo, batches, commit } = await partial(t);
  await repo.checkout(commit);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 100);
  assert.equal((await repo.worktree.list()).length, 100);
  assert.equal(repo.index.entries.length, 100);
});

test('dirty, unsafe and cancelled checkout plans do not fetch promised blob contents', async t => {
  const { repo, local, batches, commit, tree } = await partial(t);
  await repo.worktree.write('file-0.txt', 'unsaved content');
  await assert.rejects(repo.checkout(commit), { code: 'Conflict' });
  assert.equal(batches.length, 0);
  assert.equal(await local.has(tree.index.get('file-0.txt').oid), false);
  const unsafe = new Map([['../escape', { path: '../escape', oid: tree.index.get('file-0.txt').oid, mode: 0o100644 }]]);
  await assert.rejects(planCheckout(repo, unsafe, { force: true }), { code: 'Unsafe' });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(repo.checkout(commit, { force: true, signal: cancelled.signal }), { code: 'Cancelled' });
  assert.equal(batches.length, 0);
});
