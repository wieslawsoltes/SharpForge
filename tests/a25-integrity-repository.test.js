import test from 'node:test';
import assert from 'node:assert/strict';
import { GitError } from '../packages/git/src/errors.js';
import { MemoryStore } from '../packages/git/src/storage/memory-store.js';
import { ObjectDatabase } from '../packages/git/src/odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { hashObject, encodeTree, encodeCommit, serializeObject } from '../packages/git/src/objects.js';
import { deflateZlib } from '../packages/git/src/zlib.js';
import { verifyRepositoryIntegrity } from '../packages/git/src/integrity.js';
import { IntegrityReport } from '../packages/git/src/integrity/report.js';
import { verifyIntegrityGraph } from '../packages/git/src/integrity/graph.js';

const encoder = new TextEncoder();
const identity = 'Fixture <fixture@example.test> 1700000000 +0000';

async function fixture(algorithm = 'sha1') {
  const store = new MemoryStore();
  const odb = new ObjectDatabase({ store, algorithm });
  const refs = new RefDatabase({ store, algorithm, clock: () => 1700000000 });
  await refs.setSymbolic('HEAD', 'refs/heads/main', { identity });
  return { algorithm, store, odb, refs };
}

async function commitTree(repo, tree) {
  const oid = await repo.odb.write('commit', encodeCommit({ tree, author: identity, committer: identity, message: 'fixture\n' }, repo));
  await repo.refs.update('HEAD', oid, { identity });
  return oid;
}

async function rawObject(repo, type, data, address) {
  const oid = address ?? await hashObject(type, data, repo);
  await repo.store.set(`objects/${oid.slice(0, 2)}/${oid.slice(2)}`, await deflateZlib(serializeObject(type, data)));
  return oid;
}

for (const algorithm of ['sha1', 'sha256']) {
  test(`fsck verifies ${algorithm} objects, refs and external gitlinks without changing storage`, async () => {
    const repo = await fixture(algorithm);
    const blob = await repo.odb.write('blob', encoder.encode('tracked\n'));
    const tree = await repo.odb.write('tree', encodeTree([
      { name: 'file', mode: 0o100644, oid: blob }, { name: 'module', mode: 0o160000, oid: 'a'.repeat(blob.length) }
    ], repo));
    await commitTree(repo, tree);
    const before = await Promise.all((await repo.store.list()).map(async key => [key, await repo.store.get(key)]));
    const result = await verifyRepositoryIntegrity(repo);
    assert.equal(result.ok, true);
    assert.equal(result.objects, 3);
    assert.equal(result.externalLinks, 1);
    assert.equal(result.reachable, 3);
    assert.deepEqual(await Promise.all((await repo.store.list()).map(async key => [key, await repo.store.get(key)])), before);
  });
}

test('fsck classifies missing objects and their broken inbound links', async () => {
  const repo = await fixture();
  const missing = 'a'.repeat(40);
  const tree = await repo.odb.write('tree', encodeTree([{ name: 'missing', mode: 0o100644, oid: missing }]));
  await commitTree(repo, tree);
  const result = await verifyRepositoryIntegrity(repo);
  assert.equal(result.ok, false);
  assert.equal(result.categories['missing-object'], 1);
  assert.equal(result.categories['broken-link'], 1);
  assert.equal(result.diagnostics.find(item => item.category === 'missing-object').oid, missing);
});

test('fsck reads malformed loose trees without losing their bad-tree classification', async () => {
  const repo = await fixture();
  const malformed = encoder.encode(`100600 file\0${'x'.repeat(20)}`);
  const tree = await rawObject(repo, 'tree', malformed);
  await commitTree(repo, tree);
  const result = await verifyRepositoryIntegrity(repo);
  assert.equal(result.categories['bad-tree'], 1);
  assert.equal(result.categories['hash-mismatch'], undefined);
});

test('fsck identifies wrong content addresses, target types, invalid refs and index data', async () => {
  const repo = await fixture();
  const blob = await repo.odb.write('blob', encoder.encode('blob'));
  await rawObject(repo, 'blob', encoder.encode('changed'), blob);
  await repo.store.set('refs/heads/main', encoder.encode(`${blob}\n`));
  await repo.store.set('refs/heads/broken', encoder.encode('invalid-object-id\n'));
  await repo.store.set('index', encoder.encode('DIRC'));
  const result = await verifyRepositoryIntegrity(repo);
  for (const category of ['hash-mismatch', 'type-mismatch', 'bad-ref', 'bad-index']) {
    assert.ok(result.categories[category] > 0, category);
  }
});

test('unborn HEAD and dangling objects are valid; shallow boundaries suppress absent parents', async () => {
  const repo = await fixture();
  await repo.odb.write('blob', encoder.encode('dangling'));
  let result = await verifyRepositoryIntegrity(repo);
  assert.equal(result.ok, true);
  assert.equal(result.categories.dangling, 1);
  const tree = await repo.odb.write('tree', new Uint8Array());
  const oid = await repo.odb.write('commit', encodeCommit({
    tree, parents: ['b'.repeat(40)], author: identity, committer: identity, message: 'shallow\n'
  }));
  await repo.refs.update('HEAD', oid, { identity });
  await repo.store.set('shallow', encoder.encode(`${oid}\n`));
  result = await verifyRepositoryIntegrity(repo);
  assert.equal(result.ok, true);
  assert.equal(result.categories['missing-object'], undefined);
});

test('fsck rejects cancellation and bounded workloads before unbounded work', async () => {
  const repo = await fixture();
  await repo.odb.write('blob', encoder.encode('data'));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyRepositoryIntegrity(repo, { signal: controller.signal }), { code: 'Cancelled' });
  await assert.rejects(verifyRepositoryIntegrity(repo, { maxObjects: 0 }), { code: 'Limit' });
  await assert.rejects(verifyRepositoryIntegrity(repo, { maxBytes: 1 }), { code: 'Limit' });
});

test('integrity traverses arbitrary cycles iteratively with an explicit depth bound', () => {
  const nodes = new Map([
    ['a', { oid: 'a', type: 'tree', links: [{ oid: 'b', type: 'tree' }] }],
    ['b', { oid: 'b', type: 'tree', links: [{ oid: 'a', type: 'tree' }] }]
  ]);
  const report = new IntegrityReport('sha1');
  const result = verifyIntegrityGraph(nodes, [{ oid: 'a' }], report, {});
  assert.equal(report.categories.cycle, 1);
  assert.equal(result.reachable, 2);
  assert.throws(() => verifyIntegrityGraph(nodes, [], new IntegrityReport('sha1'), { maxDepth: 1 }), { code: 'Limit' });
});

test('fsck uses local promisor reads and never starts an implicit network request', async () => {
  const repo = await fixture();
  const oid = 'c'.repeat(40);
  let localReads = 0;
  repo.odb = {
    algorithm: 'sha1', list: async () => [oid],
    read: async () => { throw new Error('Unexpected remote hydration'); },
    readLocal: async () => { localReads++; throw new GitError('NotFound', 'Promised object is absent locally'); }
  };
  const result = await verifyRepositoryIntegrity(repo);
  assert.equal(localReads, 1);
  assert.equal(result.categories['missing-object'], 1);
});

test('fsck authenticates installed pack and index files even when no refs name their objects', async () => {
  const repo = await fixture();
  repo.store = {
    listPacks: async () => ['bad'], readPack: async () => ({ pack: new Uint8Array(12), index: new Uint8Array(8) })
  };
  const result = await verifyRepositoryIntegrity(repo);
  assert.equal(result.categories['bad-pack'], 1);
});
