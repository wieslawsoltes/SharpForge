import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore, ObjectDatabase, readPack, createPackReader, hashObject } from '../packages/git/src/index.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';
import { createDeepPackFixture } from './git-conformance/deep-pack-fixture.js';
import { assertNativeObjects } from './git-conformance/fetch-fixture.js';

async function* chunks(bytes) {
  for (let offset = 0; offset < bytes.length; offset += 193) yield bytes.subarray(offset, offset + 193);
}

// SF-A25-T02.6: the native pack oracle must confirm depth 50; --depth=50 alone is insufficient evidence.
test('native depth-50 packs retain every recorded object ID through streaming and indexed SHA-1/SHA-256 readers',
  { timeout: 180_000 }, async context => {
    const available = await gitAvailability();
    if (!available.available) { context.skip(available.reason); return; }
    context.diagnostic(`Reference: ${available.version}; native fast-import and verify-pack depth oracle`);
    const workspace = await fixtureWorkspace('sharpforge-a25-depth50-');
    try {
      for (const algorithm of ['sha1', 'sha256']) await context.test(algorithm, async () => {
        const fixture = await createDeepPackFixture(workspace, algorithm);
        const store = new MemoryStore();
        const odb = new ObjectDatabase({ store, algorithm });
        const parsed = await readPack(chunks(fixture.pack), { odb, staging: store, algorithm, maxDepth: 50 });
        const native = new Map(fixture.entries.map(entry => [entry.oid, entry]));
        assert.equal(parsed.count, native.size);
        for (const entry of parsed.entries) {
          assert.equal(entry.depth, native.get(entry.oid).depth, `${entry.oid}: native delta depth`);
          assert.equal(entry.offset, native.get(entry.oid).offset, `${entry.oid}: native pack offset`);
          const object = await odb.read(entry.oid);
          assert.equal(await hashObject(object.type, object.data, { algorithm }), entry.oid);
        }
        await assertNativeObjects({ odb }, fixture.git);
        const deepest = fixture.entries.find(entry => entry.depth === 50);
        const indexed = await createPackReader({ ...fixture, algorithm, maxDepth: 50, cacheBytes: 0 });
        assert.deepEqual((await indexed.read(deepest.oid)).data, (await odb.read(deepest.oid)).data);
        await assert.rejects(readPack(chunks(fixture.pack), { algorithm, maxDepth: 49 }), { code: 'Limit' });
        const limited = await createPackReader({ ...fixture, algorithm, maxDepth: 49, cacheBytes: 0 });
        await assert.rejects(limited.read(deepest.oid), { code: 'Limit' });
        const controller = new AbortController();
        await assert.rejects(readPack(chunks(fixture.pack), { algorithm, signal: controller.signal,
          onProgress: progress => { if (progress.completed === 25) controller.abort(); } }), { code: 'Cancelled' });
        assert.deepEqual(await store.list('tmp/'), [], 'Completed ingestion leaves no staging data');
      });
    } finally { await workspace.dispose(); }
  });
