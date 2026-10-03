import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryObjectDatabase, MemoryStore } from '../packages/git/src/memory-odb.js';
import { ObjectDatabase } from '../packages/git/src/odb.js';
import { encodeTree, encodeCommit } from '../packages/git/src/objects.js';

const bytes = text => new TextEncoder().encode(text);
const identity = { name: 'Storage Test', email: 'storage@example.test', timestamp: 1700000000, timezone: '+0000' };

for (const algorithm of ['sha1', 'sha256']) {
  test(`memory ODB creates and resolves a complete ${algorithm} object graph without a provider`, async () => {
    const odb = new MemoryObjectDatabase({ algorithm });
    const blob = await odb.write('blob', bytes('hello\n'));
    const tree = await odb.write('tree', encodeTree([{ name: 'hello.txt', mode: 0o100644, oid: blob }], { algorithm }));
    const commit = await odb.write('commit', encodeCommit({ tree, parents: [], author: identity,
      committer: identity, message: 'Initial storage fixture\n' }, { algorithm }));
    assert.equal(blob.length, algorithm === 'sha1' ? 40 : 64);
    assert.deepEqual(await odb.readHeader(commit), { oid: commit, type: 'commit', size: (await odb.read(commit)).data.length });
    assert.deepEqual((await odb.read(blob)).data, bytes('hello\n'));
    assert.deepEqual(await odb.list(), [blob, tree, commit].sort());
    assert.equal(await odb.has('f'.repeat(blob.length)), false);
    const altered = await odb.read(blob);
    altered.data.fill(0);
    assert.deepEqual((await odb.read(blob)).data, bytes('hello\n'));
  });
}

test('alternates find objects, reject mismatched formats, and terminate cycles', async () => {
  const first = new MemoryObjectDatabase();
  const second = new MemoryObjectDatabase();
  first.addAlternate(second);
  second.addAlternate(first);
  const oid = await second.write('blob', bytes('alternate'));
  assert.equal(await first.has(oid), true);
  assert.deepEqual(await first.list({ includeAlternates: true }), [oid]);
  assert.equal(await first.has('e'.repeat(40)), false);
  assert.throws(() => first.addAlternate(new MemoryObjectDatabase({ algorithm: 'sha256' })), { code: 'Conflict' });
  await first.remove(oid);
  assert.equal(await second.has(oid), true);
});

test('ODB verifies stored content addresses and explicit size/cancellation bounds', async () => {
  const odb = new MemoryObjectDatabase({ maxObjectBytes: 128 });
  const original = await odb.write('blob', bytes('original'));
  const replacement = await odb.write('blob', bytes('replacement'));
  const key = oid => `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  await odb.store.set(key(original), await odb.store.get(key(replacement)));
  await assert.rejects(odb.read(original), { code: 'Corrupt' });
  await assert.rejects(odb.write('blob', new Uint8Array(129)), { code: 'Limit' });
  await assert.rejects(odb.read('../outside'), { code: 'Corrupt' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(odb.write('blob', bytes('cancelled'), { signal: controller.signal }), { code: 'Cancelled' });
});

test('ODB snapshots caller data before asynchronous hashing and compression can diverge', async () => {
  const odb = new MemoryObjectDatabase();
  const source = bytes('owned at invocation');
  const pending = odb.write('blob', source);
  source.fill(0);
  const oid = await pending;
  assert.deepEqual((await odb.read(oid)).data, bytes('owned at invocation'));
});

test('memory store copies values and rolls back quota, cancellation, and thrown transactions', async () => {
  const store = new MemoryStore({ maxBytes: 16 });
  const value = bytes('stable');
  await store.set('stable', value);
  value.fill(0);
  assert.deepEqual(await store.get('stable'), bytes('stable'));
  await assert.rejects(store.transaction(async tx => {
    await tx.set('stable', bytes('changed'));
    await tx.set('oversize', new Uint8Array(17));
  }), { code: 'Quota' });
  assert.deepEqual(await store.list(), ['stable']);
  assert.deepEqual(await store.get('stable'), bytes('stable'));
  await assert.rejects(store.transaction(async tx => {
    await tx.delete('stable');
    throw new Error('abort transaction');
  }), /abort transaction/u);
  const controller = new AbortController();
  await assert.rejects(store.transaction(async tx => {
    await tx.set('new', bytes('new'));
    controller.abort();
  }, { signal: controller.signal }), { code: 'Cancelled' });
  assert.deepEqual(await store.list(), ['stable']);
  await assert.rejects(store.set('../outside', bytes('bad')), { code: 'Unsafe' });
  await store.close();
  await assert.rejects(store.get('stable'), { code: 'Disposed' });
});

test('concurrent store transactions serialize without lost updates or escaped handles', async () => {
  const store = new MemoryStore();
  await store.set('counter', Uint8Array.of(0));
  let escaped;
  await Promise.all(Array.from({ length: 100 }, () => store.transaction(async tx => {
    escaped = tx;
    const previous = await tx.get('counter');
    await Promise.resolve();
    await tx.set('counter', Uint8Array.of(previous[0] + 1));
  })));
  assert.equal((await store.get('counter'))[0], 100);
  await assert.rejects(escaped.set('late', bytes('invalid')), { code: 'Disposed' });
});

test('pack installation and object batches publish atomically', async () => {
  const store = new MemoryStore({ maxBytes: 12 });
  const id = 'a'.repeat(40);
  await assert.rejects(store.installPack({ id, pack: new Uint8Array(10), index: new Uint8Array(10) }), { code: 'Quota' });
  assert.deepEqual(await store.list(), []);
  await store.installPack({ id, pack: Uint8Array.of(1, 2), index: Uint8Array.of(3, 4) });
  assert.deepEqual(await store.listPacks(), [id]);
  assert.deepEqual((await store.readPack(id)).pack, Uint8Array.of(1, 2));
  await store.removePack(id);
  assert.deepEqual(await store.list(), []);
  const odb = new ObjectDatabase();
  await assert.rejects(odb.writeMany([{ type: 'blob', data: bytes('a') }, { type: 'blob', data: bytes('b') }],
    { maxObjects: 1 }), { code: 'Limit' });
  assert.deepEqual(await odb.list(), []);
  assert.equal((await odb.writeMany([{ type: 'blob', data: bytes('a') }, { type: 'blob', data: bytes('b') }])).length, 2);
});
