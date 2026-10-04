import test from 'node:test';
import assert from 'node:assert/strict';
import { repository, commitFile } from './a25-workflow-fixtures.js';
import { encodeShallow } from '../packages/git/src/shallow.js';
import { PromisorDatabase } from '../packages/git/src/promisor.js';
import { commitComparison } from '../packages/git/src/view-data.js';

async function historyFixture(t, algorithm) {
  const repo = await repository({ algorithm });
  t.after(() => repo.dispose());
  await repo.worktree.write('stable.txt', 'stable attribution\n');
  await repo.add(['stable.txt']);
  const commits = [];
  for (let index = 0; index < 6; index++) {
    commits.push(await commitFile(repo, 'changed.txt', `revision ${index}\n`, { message: `commit ${index}` }));
  }
  return { repo, commits, tip: commits.at(-1).oid };
}

for (const algorithm of ['sha1', 'sha256']) {
  test(`${algorithm}: shorten/deepen/unshallow updates log, parent expressions and caches with old objects retained`, async t => {
    const { repo, commits, tip } = await historyFixture(t, algorithm);
    const canonical = (await repo.odb.read(commits[4].oid)).data.slice();
    assert.equal((await repo.log({ maxCount: 100 })).length, 6);
    assert.equal((await repo.blame('stable.txt'))[0].oid, commits[0].oid);
    for (const visible of [2, 4, 1, 5, 6]) {
      const boundary = commits[commits.length - visible].oid;
      if (visible === commits.length) await repo.store.delete('shallow');
      else await repo.store.set('shallow', encodeShallow([boundary], { algorithm }));
      const expected = commits.slice(-visible).reverse().map(commit => commit.oid);
      const records = await repo.log({ maxCount: 100 });
      assert.deepEqual(records.map(commit => commit.oid), expected);
      assert.deepEqual((await repo.log({ path: 'changed.txt', maxCount: 100 })).map(commit => commit.oid), expected);
      assert.equal(await repo.revParse(`HEAD~${visible - 1}`), boundary);
      await assert.rejects(repo.revParse(`HEAD~${visible}`), { code: 'NotFound' });
      assert.deepEqual(await repo.revParse(`${boundary}^@`), { include: [], exclude: [], symmetric: false });
      assert.deepEqual(await repo.revParse(`${boundary}^!`), { include: [boundary], exclude: [], symmetric: false });
      assert.equal(repo.graph.generations.get(tip), visible);
      assert.equal((await repo.blame('stable.txt'))[0].oid, boundary);
      const detail = await commitComparison(repo, { commit: boundary }, {});
      assert.equal(detail.parent, null);
      assert.equal(detail.before.size, 0);
      if (visible !== commits.length) {
        assert.equal(records.at(-1).shallow, true);
        assert.deepEqual(records.at(-1).parents, []);
        assert.equal((await repo.readCommit(boundary)).parents.length, 1);
        const outside = commits[commits.length - visible - 1].oid;
        assert.equal(await repo.graph.isAncestor(outside, tip), false);
        assert.deepEqual(await repo.graph.mergeBases(outside, tip), []);
      }
    }
    assert.deepEqual((await repo.odb.read(commits[4].oid)).data, canonical);
    assert.equal((await repo.readCommit(commits[4].oid)).parents[0], commits[3].oid);
  });

  test(`${algorithm}: shallow log, blame and ancestor expressions never hydrate missing parents`, async t => {
    const { repo: remote, commits, tip } = await historyFixture(t, algorithm);
    const repo = await repository({ algorithm });
    t.after(() => repo.dispose());
    const visible = new Set(commits.slice(-2).map(commit => commit.oid));
    for (const oid of await remote.odb.list()) {
      const object = await remote.odb.read(oid);
      if (object.type !== 'commit' || visible.has(oid)) await repo.odb.write(object.type, object.data);
    }
    await repo.refs.update('refs/heads/main', tip, { expected: null });
    await repo.store.set('shallow', encodeShallow([commits[4].oid], { algorithm }));
    let fetched = 0;
    repo.replaceObjectDatabase(new PromisorDatabase({ odb: repo.odb, algorithm, fetchObjects: async () => {
      fetched++;
      throw new Error('A shallow parent must not be fetched');
    } }));
    assert.deepEqual((await repo.log({ maxCount: 100 })).map(commit => commit.oid), commits.slice(-2).reverse().map(commit => commit.oid));
    assert.equal((await repo.blame('stable.txt'))[0].oid, commits[4].oid);
    assert.equal(await repo.revParse('HEAD^'), commits[4].oid);
    await assert.rejects(repo.revParse('HEAD^^'), { code: 'NotFound' });
    assert.equal(await repo.graph.isAncestor(commits[3].oid, tip), false);
    assert.equal(fetched, 0);
  });
}

test('shallow boundary reload rejects malformed metadata and cancellation without publishing a new boundary', async t => {
  const { repo, commits } = await historyFixture(t, 'sha1');
  await repo.store.set('shallow', encodeShallow([commits[4].oid]));
  await repo.refreshShallow();
  const previous = repo.graph.shallow;
  await repo.store.set('shallow', new TextEncoder().encode('not-an-object-id\n'));
  await assert.rejects(repo.log(), { code: 'Corrupt' });
  assert.equal(repo.graph.shallow, previous);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(repo.refreshShallow({ signal: cancelled.signal }), { code: 'Cancelled' });
});
