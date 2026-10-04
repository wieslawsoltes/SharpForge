import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fetchRemote, gcRepository, repositoryStorageUsage } from '../packages/git/src/index.js';
import { initNodeRepository, openNodeRepository } from '../packages/git/src/fs/node.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';
import { createFetchFixture, observedTransport, assertNativeObjects, nativeObjectIds } from './git-conformance/fetch-fixture.js';
import { revisionBytes } from './git-conformance/deep-pack-fixture.js';

// SF-A25-T14: all fifty fetches use native git-http-backend; no pack installation substitutes for a fetch.
test('GC after fifty actual HTTP fetches produces one smaller native-readable pack with the identical reachable object set',
  { timeout: 240_000 }, async context => {
    const available = await gitAvailability();
    if (!available.available) { context.skip(available.reason); return; }
    context.diagnostic(`Reference: ${available.version}; fifty real upload-pack requests and native verify-pack/fsck`);
    const workspace = await fixtureWorkspace('sharpforge-a25-fetch-gc-');
    let fixture;
    let repository;
    try {
      fixture = await createFetchFixture(workspace, { name: 'maintenance' });
      const directory = join(workspace.root, 'client.git');
      repository = await initNodeRepository({ directory, bare: true });
      const observed = observedTransport(fixture.server.origin);
      const payload = revisionBytes(16384);
      const transferred = [];
      for (let iteration = 0; iteration < 50; iteration++) {
        payload[iteration * 251] ^= 0x73;
        await fixture.write('series.bin', payload);
        const tip = await fixture.commit(`maintenance generation ${iteration}`, 20 + iteration);
        await fixture.git(['push', '-q', fixture.bare, 'refs/heads/main:refs/heads/main']);
        const fetched = await fetchRemote({ ...repository, transport: observed.transport, url: fixture.url, tags: 'all' });
        assert.ok(fetched.pack && fetched.fetched > 0, `Fetch ${iteration + 1} must transfer a real pack`);
        assert.equal(await repository.refs.read('refs/remotes/origin/main'), tip);
        transferred.push(fetched.pack.checksum);
      }
      assert.equal(new Set(transferred).size, 50, 'Every fetch transfers a distinct native pack');
      assert.equal(observed.requests.filter(request => request.method === 'POST' && request.body.includes('command=fetch')).length, 50);
      const expected = await assertNativeObjects(repository, fixture.remoteGit);
      const before = await repositoryStorageUsage(repository);
      assert.ok(before.looseObjects >= 150, 'New commit/tree/blob objects are persisted through the actual fetch path');
      const controller = new AbortController();
      await assert.rejects(gcRepository({ ...repository, signal: controller.signal,
        onProgress: progress => { if (progress.completed === 1) controller.abort(); } }), { code: 'Cancelled' });
      assert.deepEqual(await repositoryStorageUsage(repository), before, 'Cancelled packing does not change persisted storage');
      const result = await gcRepository({ ...repository, now: 1700000000, prune: false });
      assert.equal(result.after.packs, 1);
      assert.equal(result.after.looseObjects, 0);
      assert.ok(result.after.totalBytes < before.totalBytes, 'Reported stored bytes must actually decrease');
      assert.deepEqual(result.pruned, []);
      assert.deepEqual(await repository.odb.list(), expected);
      await assertNativeObjects(repository, fixture.remoteGit);
      const nativeClient = (args, options = {}) => workspace.git(args, { cwd: directory, ...options });
      await nativeClient(['verify-pack', '-v', join(directory, 'objects', 'pack', `pack-${result.pack}.idx`)]);
      await nativeClient(['fsck', '--full', '--no-reflogs']);
      assert.deepEqual(await nativeObjectIds(nativeClient), expected, 'Native Git reads the exact same reachable graph');
      await repository.odb.close();
      repository = await openNodeRepository({ directory, bare: true });
      await assertNativeObjects(repository, fixture.remoteGit);
      assert.equal((await repositoryStorageUsage(repository)).packs, 1, 'One pack survives a fresh repository open');
    } finally {
      try { await repository?.odb.close(); }
      finally {
        try { await fixture?.server.close(); }
        finally { await workspace.dispose(); }
      }
    }
  });
