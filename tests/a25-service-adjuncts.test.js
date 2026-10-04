import test from 'node:test';
import assert from 'node:assert/strict';
import { writeZip } from '@sharpforge/archive';
import { parseLfsPointer, lfsObjectKey } from '../packages/git/src/lfs.js';
import { fetchRepositoryLfs } from '../packages/git/src/adjunct/lfs.js';
import { attachPromisorDatabase, readPromisorDescription } from '../packages/git/src/adjunct/promisor.js';
import { openService, commitFiles, objectFixture, authorize, identity, text, decode, remoteUrl } from './git-adjuncts/fixture.js';

test('service registers maintenance, offline, sparse, LFS, submodule and view descriptors', async t => {
  const { service } = await openService(t);
  for (const name of ['fsck', 'storageUsage', 'repack', 'gc', 'exportZip', 'importZip', 'exportBundle', 'importBundle',
    'sparseCheckout', 'configureSparseCheckout', 'lfsStatus', 'lfsFetch', 'submodules', 'initializeSubmodules',
    'fileComparison', 'repositoryTree', 'blamePage']) assert.ok(service.operations.has(name), name);
  assert.equal((await service.request('fsck')).ok, true);
  assert.equal(await service.request('aheadBehind'), null);
});

test('ignored executable configuration produces stable service diagnostics and queryable policy notices', async t => {
  const diagnostics = [];
  const { service, repo } = await openService(t, {}, { onDiagnostic: event => diagnostics.push(event) });
  repo.config.set('core.hookspath', '/untrusted/hooks');
  repo.config.set('alias.external', '!untrusted-shell');
  await repo.config.save();
  await repo.loadRules();
  await repo.loadRules();
  const notices = await service.request('policyNotices');
  assert.ok(notices.some(notice => notice.setting === 'core.hooksPath'));
  assert.ok(notices.some(notice => notice.setting === 'alias.external'));
  assert.equal(diagnostics.filter(event => event.kind === 'git-policy').length, notices.length);
  assert.ok(diagnostics.every(event => event.repositoryId === 'default' && event.code === 'GitPolicyIgnored'));
});

test('factory LFS clean stores binary content while local smudge and status never access the network', async t => {
  let calls = 0;
  const { service, repo } = await openService(t, {}, { fetch: async () => { calls++; throw new Error('unexpected network'); } });
  const binary = Uint8Array.from([0, 1, 4, 8, 255, 10]);
  await commitFiles(repo, { '.gitattributes': '*.bin filter=lfs -text\n', 'asset.bin': binary });
  const committed = await service.request('readFile', { path: 'asset.bin', revision: 'HEAD' });
  const pointer = parseLfsPointer(committed.data);
  assert.equal(pointer.size, binary.length);
  assert.deepEqual(await repo.store.get(lfsObjectKey(pointer.oid)), binary);
  assert.deepEqual(await repo.smudge('asset.bin', committed.data), binary);
  assert.deepEqual(await service.request('lfsStatus'), [{ path: 'asset.bin', oid: pointer.oid, size: binary.length, state: 'ready' }]);
  await repo.store.delete(lfsObjectKey(pointer.oid));
  assert.equal((await service.request('lfsStatus'))[0].state, 'missing');
  assert.deepEqual(await repo.smudge('asset.bin', committed.data), committed.data);
  await repo.store.set(lfsObjectKey(pointer.oid), binary);
  const result = await fetchRepositoryLfs(repo, { url: remoteUrl, materialize: true,
    transport: async () => { throw new Error('cached LFS requested a server'); } });
  assert.equal(result[0].cached, true);
  assert.deepEqual((await repo.worktree.read('asset.bin')).data, binary);
  assert.equal(calls, 0);
});

test('ZIP service roundtrip preserves executable mode and bytes, stages files and respects export-ignore', async t => {
  const source = await openService(t, { repositoryId: 'source' });
  await commitFiles(source.repo, { '.gitattributes': 'private.txt export-ignore\n', 'private.txt': 'private',
    'src/run.sh': { data: '#!/bin/sh\nexit 0\n', mode: 0o100755 }, 'src/data.bin': Uint8Array.of(0, 255, 3) });
  const exported = await source.service.request('exportZip', { repositoryId: 'source' });
  assert.equal(exported.entries.some(entry => entry.path === 'private.txt'), false);
  const target = await openService(t);
  const imported = await target.service.request('importZip', { bytes: exported.bytes, stage: true });
  assert.equal(imported.staged, true);
  assert.equal(target.repo.index.get('src/run.sh').mode, 0o100755);
  assert.equal(decode((await target.repo.worktree.read('src/run.sh')).data), '#!/bin/sh\nexit 0\n');
  assert.deepEqual((await target.repo.worktree.read('src/data.bin')).data, Uint8Array.of(0, 255, 3));
  assert.equal(await target.repo.worktree.read('private.txt'), null);
  assert.equal((await target.service.request('fsck')).ok, true);
});

test('ZIP validates all paths, overwrite and editor guards before effects, including existing path collisions', async t => {
  const { service, repo } = await openService(t, { dirtyBuffers: path => path === 'locked.txt' });
  await repo.worktree.write('existing.txt', 'keep');
  const baseline = await repo.worktree.list();
  await assert.rejects(service.request('importZip', { bytes: writeZip([
    { path: 'new.txt', bytes: text('new') }, { path: '.git/config', bytes: text('unsafe') }
  ]) }), { code: 'Unsafe' });
  await assert.rejects(service.request('importZip', { bytes: writeZip([
    { path: 'new.txt', bytes: text('new') }, { path: 'existing.txt', bytes: text('replacement') }
  ]) }), { code: 'Conflict' });
  await assert.rejects(service.request('importZip', { bytes: writeZip([{ path: 'locked.txt', bytes: text('edit') }]), overwrite: true }),
    { code: 'Conflict' });
  await assert.rejects(service.request('importZip', { bytes: writeZip([{ path: 'existing.txt/child', bytes: text('bad') }]) }),
    { code: 'Unsafe' });
  assert.deepEqual(await repo.worktree.list(), baseline);
  assert.equal(decode((await repo.worktree.read('existing.txt')).data), 'keep');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.request('importZip', { bytes: writeZip([{ path: 'new.txt', bytes: text('new') }]) },
    { signal: controller.signal }), { code: 'Cancelled' });
  assert.deepEqual(await repo.worktree.list(), baseline);
});

for (const algorithm of ['sha1', 'sha256']) {
  test('offline bundle and maintenance service preserve the complete ' + algorithm + ' object graph', async t => {
    const source = await openService(t, { algorithm });
    const commit = await commitFiles(source.repo, { 'readme.txt': 'bundled\n' });
    const bundle = await source.service.request('exportBundle');
    assert.equal(bundle.algorithm, algorithm);
    const target = await openService(t, { algorithm });
    const imported = await target.service.request('importBundle', { bytes: bundle.bytes });
    assert.equal(imported.version, algorithm === 'sha1' ? 2 : 3);
    assert.equal(await target.repo.refs.read('HEAD'), commit.oid);
    assert.deepEqual((await target.service.request('readFile', { path: 'readme.txt', revision: 'HEAD' })).data, text('bundled\n'));
    const before = await target.service.request('storageUsage');
    assert.ok(before.looseObjects >= 3);
    await target.service.request('log');
    const packed = await target.service.request('repack');
    assert.equal(packed.after.packs, 1);
    assert.equal(packed.after.looseObjects, 0);
    assert.equal((await target.service.request('fsck')).ok, true);
    assert.equal((await target.service.request('log'))[0].oid, commit.oid);
    const collected = await target.service.request('gc', { now: 1700000000 });
    assert.equal(collected.pruned.length, 0);
    assert.equal((await target.service.request('fsck')).ok, true);
    const corrupt = bundle.bytes.slice();
    corrupt[corrupt.length - 1] ^= 1;
    await assert.rejects(target.service.request('importBundle', { bytes: corrupt }), { code: 'Corrupt' });
    assert.equal(await target.repo.refs.read('HEAD'), commit.oid);
    await source.repo.store.set('shallow', text(commit.oid + '\n'));
    await assert.rejects(source.service.request('exportBundle'), { code: 'Unsupported' });
  });
}

test('sparse service updates index, patterns and config together, rejects dirty loss and can disable the cone', async t => {
  const { service, repo } = await openService(t);
  await commitFiles(repo, { 'root.txt': 'root', 'src/main.txt': 'src', 'docs/guide.txt': 'docs' });
  const selected = await service.request('configureSparseCheckout', { directories: ['src'] });
  assert.deepEqual(selected.removed, ['docs/guide.txt']);
  assert.equal(repo.index.get('docs/guide.txt').skipWorktree, true);
  assert.equal(await repo.worktree.read('docs/guide.txt'), null);
  assert.equal((await service.request('sparseCheckout')).enabled, true);
  await service.request('configureSparseCheckout', { disable: true });
  assert.equal(decode((await repo.worktree.read('docs/guide.txt')).data), 'docs');
  assert.equal(repo.index.get('docs/guide.txt').skipWorktree, false);
  assert.equal((await service.request('sparseCheckout')).enabled, false);
  await repo.worktree.write('docs/guide.txt', 'changed');
  const config = await repo.store.get('config');
  const patterns = await repo.store.get('info/sparse-checkout');
  await assert.rejects(service.request('configureSparseCheckout', { directories: ['src'] }), { code: 'Conflict' });
  assert.deepEqual(await repo.store.get('config'), config);
  assert.deepEqual(await repo.store.get('info/sparse-checkout'), patterns);
  assert.equal(decode((await repo.worktree.read('docs/guide.txt')).data), 'changed');
  assert.equal(repo.index.get('docs/guide.txt').skipWorktree, false);
});

test('promisor metadata alone grants no network, local fsck remains local and authorized reads share hydration', async t => {
  const fixture = await objectFixture(t);
  const { service, repo } = await openService(t);
  await repo.odb.write('tree', (await fixture.repo.odb.read(fixture.tree)).data);
  await repo.odb.write('commit', (await fixture.repo.odb.read(fixture.tip)).data);
  await repo.refs.update('refs/heads/main', fixture.tip);
  const description = { url: remoteUrl, filter: 'blob:none', algorithm: 'sha1' };
  await repo.store.set('sharpforge/promisor', text(JSON.stringify(description)));
  assert.deepEqual(await readPromisorDescription(repo.store), description);
  attachPromisorDatabase(repo, description);
  await assert.rejects(repo.odb.read(fixture.blob), { code: 'Auth' });
  const local = await service.request('fsck');
  assert.equal(local.ok, false);
  assert.ok(local.categories['missing-object'] > 0);
  let fetched = 0;
  attachPromisorDatabase(repo, description, async ({ repository, oids }) => {
    fetched++;
    for (const oid of oids) {
      const object = await fixture.repo.odb.read(oid);
      await repository.odb.write(object.type, object.data);
    }
  });
  const [left, right] = await Promise.all([repo.odb.read(fixture.blob), repo.odb.read(fixture.blob)]);
  assert.deepEqual(left.data, right.data);
  assert.equal(fetched, 1);
  assert.equal((await service.request('fsck')).ok, true);
  repo.dispose();
  await assert.rejects(repo.odb.prefetch(['a'.repeat(40)]), { code: 'Cancelled' });
});

test('submodule service requires exact per-path URL trust and explicit nested storage capabilities', async t => {
  const { service, repo } = await openService(t, {}, { submodules: { createRepository: null } });
  await commitFiles(repo, { '.gitmodules': '[submodule "library"]\n path = deps/library\n url = ../library.git\n' });
  repo.index.set({ path: 'deps/library', oid: 'a'.repeat(40), mode: 0o160000, stage: 0 });
  await repo.saveIndex();
  await repo.commit({ message: 'pin library', author: identity, committer: identity });
  repo.config.set('remote.origin.url', remoteUrl);
  await repo.config.save();
  const modules = await service.request('submodules');
  assert.equal(modules[0].url, 'https://git.test/library.git');
  assert.equal(modules[0].oid, 'a'.repeat(40));
  assert.equal((await service.request('initializeSubmodules'))[0].reason, 'trust-required');
  assert.equal((await service.request('initializeSubmodules', {
    trustedSubmodules: [{ path: 'deps/library', url: 'https://other.test/library.git' }]
  }))[0].reason, 'trust-required');
  await authorize(service);
  await assert.rejects(service.request('initializeSubmodules', {
    trustedSubmodules: [{ path: modules[0].path, url: modules[0].url }]
  }), { code: 'Unsupported' });
  await assert.rejects(service.request('initializeSubmodules', { paths: ['unknown'] }), { code: 'NotFound' });
  await assert.rejects(service.request('initializeSubmodules', { recursive: true }), { code: 'Unsupported' });
});
